import { useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { confirmAsync } from "@/components/ConfirmDialog";

const MAX_SIZE = 3 * 1024 * 1024; // 3 MB
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export function AvatarUpload() {
  const { user, profile, updateProfile, refreshProfile } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    if (!user) return;
    if (!ALLOWED.includes(file.type)) {
      toast.error("Use uma imagem JPG, PNG ou WEBP.");
      return;
    }
    if (file.size > MAX_SIZE) {
      toast.error("A imagem deve ter no máximo 3 MB.");
      return;
    }
    setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type, cacheControl: "3600" });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = `${pub.publicUrl}?v=${Date.now()}`;

      // Try to delete previous avatar to avoid orphan files
      const prev = profile?.avatar_url;
      if (prev) {
        const m = prev.match(/\/avatars\/(.+?)(\?|$)/);
        if (m?.[1] && m[1].startsWith(`${user.id}/`)) {
          await supabase.storage.from("avatars").remove([m[1]]);
        }
      }

      const { error } = await updateProfile({ avatar_url: url });
      if (error) throw error;
      await refreshProfile();
      toast.success("Foto atualizada!");
    } catch (e) {
      console.error("[avatar] upload", e);
      toast.error("Não foi possível enviar a foto agora.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove() {
    if (!user || !profile?.avatar_url) return;
    if (
      !(await confirmAsync({
        title: "Remover sua foto de perfil?",
        destructive: true,
        confirmText: "Remover",
      }))
    )
      return;
    setBusy(true);
    try {
      const m = profile.avatar_url.match(/\/avatars\/(.+?)(\?|$)/);
      if (m?.[1]) await supabase.storage.from("avatars").remove([m[1]]);
      await updateProfile({ avatar_url: null });
      await refreshProfile();
      toast.success("Foto removida.");
    } catch (e) {
      console.error("[avatar] remove", e);
      toast.error("Não foi possível remover a foto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <UserAvatar
          url={profile?.avatar_url}
          name={profile?.nome ?? profile?.responsavel_nome}
          email={user?.email}
          size={80}
          className="ring-2 ring-primary/30"
        />
        {busy && (
          <span className="absolute inset-0 grid place-items-center rounded-full bg-background/70 backdrop-blur-sm">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-xl"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <Camera className="mr-2 h-4 w-4" />
          {profile?.avatar_url ? "Trocar foto" : "Enviar foto"}
        </Button>
        {profile?.avatar_url && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={busy}
            onClick={handleRemove}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Remover foto
          </Button>
        )}
        <p className="text-[11px] text-muted-foreground">JPG, PNG ou WEBP até 3 MB.</p>
      </div>
    </div>
  );
}
