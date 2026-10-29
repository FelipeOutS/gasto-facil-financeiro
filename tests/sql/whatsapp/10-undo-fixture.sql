    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
    CREATE TABLE categorias(id uuid PRIMARY KEY, user_id uuid NOT NULL);
    CREATE TABLE cartoes(id uuid PRIMARY KEY, user_id uuid NOT NULL);
    CREATE TABLE gastos(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
      origem text, descricao text NOT NULL, estabelecimento text NOT NULL DEFAULT '',
      valor numeric(14,2) NOT NULL, data date NOT NULL, mes smallint NOT NULL, ano integer NOT NULL,
      forma_pagamento text NOT NULL, categoria_id uuid, cartao_id uuid,
      grupo_parcelamento_id uuid, recorrencia_id uuid, total_parcelas smallint,
      invoice_month text, fatura_competencia text, deleted_at timestamptz, updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE receitas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
      origem text, descricao text NOT NULL, valor numeric(14,2) NOT NULL, data date NOT NULL,
      mes smallint NOT NULL, ano integer NOT NULL, recorrencia_id uuid, deleted_at timestamptz, updated_at timestamptz DEFAULT now());
    CREATE TABLE recorrencias(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, origem text, status text);
    CREATE TABLE contas_a_pagar(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
      status text, data_pagamento date, gasto_id uuid);
