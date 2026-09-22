-- Ciphertexts are prepared in the client. No password or raw key enters this RPC.
CREATE OR REPLACE FUNCTION public.vault_rotate_master_key_atomic(
  p_expected_settings jsonb,
  p_new_settings jsonb,
  p_entries jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_settings public.vault_settings%ROWTYPE;
  v_entry jsonb;
  v_count bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'vault_rotation_unauthorized' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_expected_settings) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_new_settings) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_entries) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'vault_rotation_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF octet_length(p_entries::text) > 16777216 THEN
    RAISE EXCEPTION 'vault_rotation_payload_too_large' USING ERRCODE = '22023';
  END IF;
  IF coalesce(length(p_new_settings->>'salt'), 0) < 16
     OR coalesce(length(p_new_settings->>'verifier'), 0) < 16
     OR coalesce(length(p_new_settings->>'verifier_iv'), 0) < 12
     OR coalesce((p_new_settings->>'iterations')::integer, 0) < 100000
     OR p_new_settings->>'salt' = p_expected_settings->>'salt' THEN
    RAISE EXCEPTION 'vault_rotation_invalid_settings' USING ERRCODE = '22023';
  END IF;

  -- Also exclude ordinary entry INSERT/UPDATE/DELETE while validating the snapshot.
  -- Locks last only for persistence, never during client cryptography. Reads continue.
  -- Consistent order prevents two rotations from deadlocking on lock upgrades.
  LOCK TABLE public.vault_entries, public.vault_pin_settings IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO v_settings FROM public.vault_settings WHERE user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vault_rotation_missing_settings' USING ERRCODE = '40001';
  END IF;
  -- The random salt + authenticated verifier are an opaque key-generation token.
  IF jsonb_build_object('salt', v_settings.salt, 'iterations', v_settings.iterations,
       'verifier', v_settings.verifier, 'verifier_iv', v_settings.verifier_iv,
       'hint', v_settings.hint) IS DISTINCT FROM p_expected_settings THEN
    RAISE EXCEPTION 'vault_rotation_conflict' USING ERRCODE = '40001';
  END IF;
  SELECT count(*) INTO v_count FROM public.vault_entries WHERE user_id = v_uid;
  IF v_count <> jsonb_array_length(p_entries)
     OR v_count <> (SELECT count(DISTINCT (e->>'id')::uuid) FROM jsonb_array_elements(p_entries) e) THEN
    RAISE EXCEPTION 'vault_rotation_entries_changed' USING ERRCODE = '40001';
  END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.vault_entries e
      WHERE e.id = (v_entry->>'id')::uuid AND e.user_id = v_uid
        AND jsonb_build_object('username_cipher', e.username_cipher,
          'password_cipher', e.password_cipher, 'notes_cipher', e.notes_cipher,
          'cipher_iv', e.cipher_iv)
          = ((v_entry->'expected') - 'updated_at')
        AND e.updated_at = (v_entry->'expected'->>'updated_at')::timestamptz
    ) THEN
      RAISE EXCEPTION 'vault_rotation_entries_changed' USING ERRCODE = '40001';
    END IF;
    IF jsonb_typeof(v_entry->'replacement') IS DISTINCT FROM 'object'
       OR coalesce(length(v_entry->'replacement'->>'username_cipher'), 0) < 16
       OR coalesce(length(v_entry->'replacement'->>'password_cipher'), 0) < 16
       OR coalesce(length(v_entry->'replacement'->>'notes_cipher'), 0) < 16
       OR coalesce(length(v_entry->'replacement'->>'cipher_iv'), 0) < 12 THEN
      RAISE EXCEPTION 'vault_rotation_invalid_ciphertext' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  UPDATE public.vault_entries e SET
    username_cipher = x.replacement->>'username_cipher',
    password_cipher = x.replacement->>'password_cipher',
    notes_cipher = x.replacement->>'notes_cipher',
    cipher_iv = x.replacement->>'cipher_iv'
  FROM jsonb_to_recordset(p_entries) AS x(id uuid, replacement jsonb)
  WHERE e.id = x.id AND e.user_id = v_uid;

  UPDATE public.vault_settings SET
    salt = p_new_settings->>'salt', verifier = p_new_settings->>'verifier',
    verifier_iv = p_new_settings->>'verifier_iv',
    iterations = (p_new_settings->>'iterations')::integer,
    hint = p_new_settings->>'hint'
  WHERE user_id = v_uid RETURNING * INTO v_settings;

  -- The PIN envelope wraps the replaced key. Invalidate only as part of the commit.
  DELETE FROM public.vault_pin_settings WHERE user_id = v_uid;
  RETURN to_jsonb(v_settings);
END;
$$;
REVOKE ALL ON FUNCTION public.vault_rotate_master_key_atomic(jsonb,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vault_rotate_master_key_atomic(jsonb,jsonb,jsonb) TO authenticated;
