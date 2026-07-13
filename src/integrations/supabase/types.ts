export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      aprendizado_categoria: {
        Row: {
          categoria_id: string
          created_at: string
          estabelecimento: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          categoria_id: string
          created_at?: string
          estabelecimento: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          categoria_id?: string
          created_at?: string
          estabelecimento?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "aprendizado_categoria_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          metadata: Json | null
          new_data: Json | null
          old_data: Json | null
          target_email: string | null
          target_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          new_data?: Json | null
          old_data?: Json | null
          target_email?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          new_data?: Json | null
          old_data?: Json | null
          target_email?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      bancos: {
        Row: {
          color_hex: string
          created_at: string
          criado_pelo_usuario: boolean
          icone: string | null
          id: string
          legacy_id: string | null
          nome: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color_hex?: string
          created_at?: string
          criado_pelo_usuario?: boolean
          icone?: string | null
          id?: string
          legacy_id?: string | null
          nome: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color_hex?: string
          created_at?: string
          criado_pelo_usuario?: boolean
          icone?: string | null
          id?: string
          legacy_id?: string | null
          nome?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      brand_assets: {
        Row: {
          company_name: string | null
          created_at: string
          domain: string
          id: string
          last_checked_at: string
          logo_url: string | null
          normalized_name: string | null
          primary_color: string | null
          secondary_color: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          domain: string
          id?: string
          last_checked_at?: string
          logo_url?: string | null
          normalized_name?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          company_name?: string | null
          created_at?: string
          domain?: string
          id?: string
          last_checked_at?: string
          logo_url?: string | null
          normalized_name?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      cartoes: {
        Row: {
          banco: string
          cor: string
          created_at: string
          dia_fechamento: number
          dia_vencimento: number
          id: string
          legacy_id: string | null
          limite_total: number
          nome: string
          observacao: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          banco?: string
          cor?: string
          created_at?: string
          dia_fechamento?: number
          dia_vencimento?: number
          id?: string
          legacy_id?: string | null
          limite_total?: number
          nome: string
          observacao?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          banco?: string
          cor?: string
          created_at?: string
          dia_fechamento?: number
          dia_vencimento?: number
          id?: string
          legacy_id?: string | null
          limite_total?: number
          nome?: string
          observacao?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      categorias: {
        Row: {
          color_var: string
          created_at: string
          criada_pelo_usuario: boolean
          icon_name: string
          id: string
          legacy_id: string | null
          nome: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color_var: string
          created_at?: string
          criada_pelo_usuario?: boolean
          icon_name: string
          id?: string
          legacy_id?: string | null
          nome: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color_var?: string
          created_at?: string
          criada_pelo_usuario?: boolean
          icon_name?: string
          id?: string
          legacy_id?: string | null
          nome?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      clientes: {
        Row: {
          apelido: string | null
          ativo: boolean
          bairro: string | null
          cep: string | null
          cnae_principal_codigo: string | null
          cnae_principal_descricao: string | null
          cnpj: string | null
          cnpj_cache_fetched_at: string | null
          complemento: string | null
          created_at: string
          email: string | null
          id: string
          logradouro: string | null
          municipio: string | null
          nome: string
          nome_fantasia: string | null
          numero: string | null
          observacoes: string | null
          razao_social: string | null
          situacao_cadastral: string | null
          source: string | null
          telefone: string | null
          uf: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          apelido?: string | null
          ativo?: boolean
          bairro?: string | null
          cep?: string | null
          cnae_principal_codigo?: string | null
          cnae_principal_descricao?: string | null
          cnpj?: string | null
          cnpj_cache_fetched_at?: string | null
          complemento?: string | null
          created_at?: string
          email?: string | null
          id?: string
          logradouro?: string | null
          municipio?: string | null
          nome: string
          nome_fantasia?: string | null
          numero?: string | null
          observacoes?: string | null
          razao_social?: string | null
          situacao_cadastral?: string | null
          source?: string | null
          telefone?: string | null
          uf?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          apelido?: string | null
          ativo?: boolean
          bairro?: string | null
          cep?: string | null
          cnae_principal_codigo?: string | null
          cnae_principal_descricao?: string | null
          cnpj?: string | null
          cnpj_cache_fetched_at?: string | null
          complemento?: string | null
          created_at?: string
          email?: string | null
          id?: string
          logradouro?: string | null
          municipio?: string | null
          nome?: string
          nome_fantasia?: string | null
          numero?: string | null
          observacoes?: string | null
          razao_social?: string | null
          situacao_cadastral?: string | null
          source?: string | null
          telefone?: string | null
          uf?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      cnpj_cache: {
        Row: {
          bairro: string | null
          cep: string | null
          cnae_principal_codigo: string | null
          cnae_principal_descricao: string | null
          cnpj: string
          complemento: string | null
          created_at: string
          data_abertura: string | null
          expires_at: string
          fetched_at: string
          logradouro: string | null
          municipio: string | null
          natureza_juridica: string | null
          nome_fantasia: string | null
          numero: string | null
          porte: string | null
          raw_payload: Json | null
          razao_social: string | null
          situacao_cadastral: string | null
          source: string | null
          uf: string | null
          updated_at: string
        }
        Insert: {
          bairro?: string | null
          cep?: string | null
          cnae_principal_codigo?: string | null
          cnae_principal_descricao?: string | null
          cnpj: string
          complemento?: string | null
          created_at?: string
          data_abertura?: string | null
          expires_at?: string
          fetched_at?: string
          logradouro?: string | null
          municipio?: string | null
          natureza_juridica?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          porte?: string | null
          raw_payload?: Json | null
          razao_social?: string | null
          situacao_cadastral?: string | null
          source?: string | null
          uf?: string | null
          updated_at?: string
        }
        Update: {
          bairro?: string | null
          cep?: string | null
          cnae_principal_codigo?: string | null
          cnae_principal_descricao?: string | null
          cnpj?: string
          complemento?: string | null
          created_at?: string
          data_abertura?: string | null
          expires_at?: string
          fetched_at?: string
          logradouro?: string | null
          municipio?: string | null
          natureza_juridica?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          porte?: string | null
          raw_payload?: Json | null
          razao_social?: string | null
          situacao_cadastral?: string | null
          source?: string | null
          uf?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      community_market_prices: {
        Row: {
          barcode: string | null
          brand: string | null
          category: string | null
          city: string | null
          confidence: number | null
          created_at: string
          id: string
          image_confidence: number | null
          image_source: string | null
          image_url: string | null
          market_id: string | null
          market_name: string
          neighborhood: string | null
          normalized_product_name: string | null
          notes: string | null
          price: number
          product_name: string
          seen_at: string
          source: string
          status: string
          unit: string | null
          updated_at: string
          user_id: string
          valid_until: string | null
        }
        Insert: {
          barcode?: string | null
          brand?: string | null
          category?: string | null
          city?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          image_confidence?: number | null
          image_source?: string | null
          image_url?: string | null
          market_id?: string | null
          market_name: string
          neighborhood?: string | null
          normalized_product_name?: string | null
          notes?: string | null
          price: number
          product_name: string
          seen_at?: string
          source?: string
          status?: string
          unit?: string | null
          updated_at?: string
          user_id: string
          valid_until?: string | null
        }
        Update: {
          barcode?: string | null
          brand?: string | null
          category?: string | null
          city?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          image_confidence?: number | null
          image_source?: string | null
          image_url?: string | null
          market_id?: string | null
          market_name?: string
          neighborhood?: string | null
          normalized_product_name?: string | null
          notes?: string | null
          price?: number
          product_name?: string
          seen_at?: string
          source?: string
          status?: string
          unit?: string | null
          updated_at?: string
          user_id?: string
          valid_until?: string | null
        }
        Relationships: []
      }
      connected_accounts: {
        Row: {
          accepted_at: string | null
          access_level: Database["public"]["Enums"]["connected_account_access"]
          created_at: string
          id: string
          invite_expires_at: string
          invite_sent_at: string
          invite_token: string
          invited_email: string
          nickname: string | null
          owner_user_id: string | null
          refused_at: string | null
          removed_at: string | null
          removed_by_user_id: string | null
          status: Database["public"]["Enums"]["connected_account_status"]
          updated_at: string
          viewer_user_id: string
        }
        Insert: {
          accepted_at?: string | null
          access_level?: Database["public"]["Enums"]["connected_account_access"]
          created_at?: string
          id?: string
          invite_expires_at?: string
          invite_sent_at?: string
          invite_token?: string
          invited_email: string
          nickname?: string | null
          owner_user_id?: string | null
          refused_at?: string | null
          removed_at?: string | null
          removed_by_user_id?: string | null
          status?: Database["public"]["Enums"]["connected_account_status"]
          updated_at?: string
          viewer_user_id: string
        }
        Update: {
          accepted_at?: string | null
          access_level?: Database["public"]["Enums"]["connected_account_access"]
          created_at?: string
          id?: string
          invite_expires_at?: string
          invite_sent_at?: string
          invite_token?: string
          invited_email?: string
          nickname?: string | null
          owner_user_id?: string | null
          refused_at?: string | null
          removed_at?: string | null
          removed_by_user_id?: string | null
          status?: Database["public"]["Enums"]["connected_account_status"]
          updated_at?: string
          viewer_user_id?: string
        }
        Relationships: []
      }
      contas_a_pagar: {
        Row: {
          ano: number
          banco_emissor: string | null
          beneficiario: string | null
          categoria_id: string | null
          chave_pix: string | null
          codigo_boleto: string | null
          codigo_pix: string | null
          created_at: string
          data_fim: string | null
          data_inicio: string | null
          data_pagamento: string | null
          data_vencimento: string
          forma_pagamento: string | null
          fornecedor_id: string | null
          frequencia_recorrencia: string | null
          gasto_id: string | null
          id: string
          import_batch_id: string | null
          mes: number
          mes_referencia: string | null
          nome: string
          observacao: string | null
          recorrencia_id: string | null
          recorrente: boolean
          status: string
          updated_at: string
          user_id: string
          valor: number
        }
        Insert: {
          ano: number
          banco_emissor?: string | null
          beneficiario?: string | null
          categoria_id?: string | null
          chave_pix?: string | null
          codigo_boleto?: string | null
          codigo_pix?: string | null
          created_at?: string
          data_fim?: string | null
          data_inicio?: string | null
          data_pagamento?: string | null
          data_vencimento: string
          forma_pagamento?: string | null
          fornecedor_id?: string | null
          frequencia_recorrencia?: string | null
          gasto_id?: string | null
          id?: string
          import_batch_id?: string | null
          mes: number
          mes_referencia?: string | null
          nome: string
          observacao?: string | null
          recorrencia_id?: string | null
          recorrente?: boolean
          status?: string
          updated_at?: string
          user_id: string
          valor?: number
        }
        Update: {
          ano?: number
          banco_emissor?: string | null
          beneficiario?: string | null
          categoria_id?: string | null
          chave_pix?: string | null
          codigo_boleto?: string | null
          codigo_pix?: string | null
          created_at?: string
          data_fim?: string | null
          data_inicio?: string | null
          data_pagamento?: string | null
          data_vencimento?: string
          forma_pagamento?: string | null
          fornecedor_id?: string | null
          frequencia_recorrencia?: string | null
          gasto_id?: string | null
          id?: string
          import_batch_id?: string | null
          mes?: number
          mes_referencia?: string | null
          nome?: string
          observacao?: string | null
          recorrencia_id?: string | null
          recorrente?: boolean
          status?: string
          updated_at?: string
          user_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "contas_a_pagar_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_a_pagar_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
        ]
      }
      contas_a_receber: {
        Row: {
          categoria: string | null
          cliente_id: string | null
          created_at: string
          data_prevista: string
          data_recebimento: string | null
          forma_recebimento: string | null
          id: string
          observacao: string | null
          origem: string | null
          pagador_nome: string | null
          status: string
          tipo_recebimento: string
          titulo: string
          updated_at: string
          user_id: string
          valor_recebido: number
          valor_restante: number
          valor_total: number
        }
        Insert: {
          categoria?: string | null
          cliente_id?: string | null
          created_at?: string
          data_prevista: string
          data_recebimento?: string | null
          forma_recebimento?: string | null
          id?: string
          observacao?: string | null
          origem?: string | null
          pagador_nome?: string | null
          status?: string
          tipo_recebimento?: string
          titulo: string
          updated_at?: string
          user_id: string
          valor_recebido?: number
          valor_restante?: number
          valor_total?: number
        }
        Update: {
          categoria?: string | null
          cliente_id?: string | null
          created_at?: string
          data_prevista?: string
          data_recebimento?: string | null
          forma_recebimento?: string | null
          id?: string
          observacao?: string | null
          origem?: string | null
          pagador_nome?: string | null
          status?: string
          tipo_recebimento?: string
          titulo?: string
          updated_at?: string
          user_id?: string
          valor_recebido?: number
          valor_restante?: number
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "contas_a_receber_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      dinheiro_guardado: {
        Row: {
          banco_id: string | null
          created_at: string
          data_atualizacao: string
          id: string
          import_batch_id: string | null
          legacy_id: string | null
          meta_id: string | null
          observacao: string | null
          tipo_reserva: string
          updated_at: string
          user_id: string
          valor: number
        }
        Insert: {
          banco_id?: string | null
          created_at?: string
          data_atualizacao?: string
          id?: string
          import_batch_id?: string | null
          legacy_id?: string | null
          meta_id?: string | null
          observacao?: string | null
          tipo_reserva?: string
          updated_at?: string
          user_id: string
          valor?: number
        }
        Update: {
          banco_id?: string | null
          created_at?: string
          data_atualizacao?: string
          id?: string
          import_batch_id?: string | null
          legacy_id?: string | null
          meta_id?: string | null
          observacao?: string | null
          tipo_reserva?: string
          updated_at?: string
          user_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "dinheiro_guardado_banco_id_fkey"
            columns: ["banco_id"]
            isOneToOne: false
            referencedRelation: "bancos"
            referencedColumns: ["id"]
          },
        ]
      }
      economic_indicators: {
        Row: {
          created_at: string
          currency: string | null
          fetched_at: string
          high: number | null
          id: string
          indicator_key: string
          low: number | null
          name: string
          raw_payload: Json | null
          source: string
          updated_at: string
          value: number
          variation_percent: number | null
        }
        Insert: {
          created_at?: string
          currency?: string | null
          fetched_at?: string
          high?: number | null
          id?: string
          indicator_key: string
          low?: number | null
          name: string
          raw_payload?: Json | null
          source?: string
          updated_at?: string
          value: number
          variation_percent?: number | null
        }
        Update: {
          created_at?: string
          currency?: string | null
          fetched_at?: string
          high?: number | null
          id?: string
          indicator_key?: string
          low?: number | null
          name?: string
          raw_payload?: Json | null
          source?: string
          updated_at?: string
          value?: number
          variation_percent?: number | null
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      extratos_importados: {
        Row: {
          banco: string | null
          created_at: string
          data_importacao: string
          id: string
          nome_arquivo: string | null
          observacao: string | null
          periodo_fim: string | null
          periodo_inicio: string | null
          qtd_duplicadas_ignoradas: number
          qtd_movimentacoes: number
          reverted_at: string | null
          status: string
          tipo_origem: string
          total_despesas: number
          total_guardado: number
          total_receitas: number
          total_transferencias: number
          updated_at: string
          user_id: string
        }
        Insert: {
          banco?: string | null
          created_at?: string
          data_importacao?: string
          id?: string
          nome_arquivo?: string | null
          observacao?: string | null
          periodo_fim?: string | null
          periodo_inicio?: string | null
          qtd_duplicadas_ignoradas?: number
          qtd_movimentacoes?: number
          reverted_at?: string | null
          status?: string
          tipo_origem?: string
          total_despesas?: number
          total_guardado?: number
          total_receitas?: number
          total_transferencias?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          banco?: string | null
          created_at?: string
          data_importacao?: string
          id?: string
          nome_arquivo?: string | null
          observacao?: string | null
          periodo_fim?: string | null
          periodo_inicio?: string | null
          qtd_duplicadas_ignoradas?: number
          qtd_movimentacoes?: number
          reverted_at?: string | null
          status?: string
          tipo_origem?: string
          total_despesas?: number
          total_guardado?: number
          total_receitas?: number
          total_transferencias?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      faturas_cartao: {
        Row: {
          ano: number
          cartao_id: string
          created_at: string
          data_pagamento: string | null
          id: string
          mes: number
          observacao: string | null
          status: string
          updated_at: string
          user_id: string
          valor_pago: number
        }
        Insert: {
          ano: number
          cartao_id: string
          created_at?: string
          data_pagamento?: string | null
          id?: string
          mes: number
          observacao?: string | null
          status?: string
          updated_at?: string
          user_id: string
          valor_pago?: number
        }
        Update: {
          ano?: number
          cartao_id?: string
          created_at?: string
          data_pagamento?: string | null
          id?: string
          mes?: number
          observacao?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          valor_pago?: number
        }
        Relationships: []
      }
      fornecedores: {
        Row: {
          apelido: string | null
          ativo: boolean
          bairro: string | null
          cep: string | null
          cnae_principal_codigo: string | null
          cnae_principal_descricao: string | null
          cnpj: string | null
          cnpj_cache_fetched_at: string | null
          complemento: string | null
          created_at: string
          email: string | null
          id: string
          logradouro: string | null
          municipio: string | null
          nome: string
          nome_fantasia: string | null
          numero: string | null
          observacoes: string | null
          pix_key: string | null
          pix_key_type: string | null
          razao_social: string | null
          situacao_cadastral: string | null
          source: string | null
          telefone: string | null
          uf: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          apelido?: string | null
          ativo?: boolean
          bairro?: string | null
          cep?: string | null
          cnae_principal_codigo?: string | null
          cnae_principal_descricao?: string | null
          cnpj?: string | null
          cnpj_cache_fetched_at?: string | null
          complemento?: string | null
          created_at?: string
          email?: string | null
          id?: string
          logradouro?: string | null
          municipio?: string | null
          nome: string
          nome_fantasia?: string | null
          numero?: string | null
          observacoes?: string | null
          pix_key?: string | null
          pix_key_type?: string | null
          razao_social?: string | null
          situacao_cadastral?: string | null
          source?: string | null
          telefone?: string | null
          uf?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          apelido?: string | null
          ativo?: boolean
          bairro?: string | null
          cep?: string | null
          cnae_principal_codigo?: string | null
          cnae_principal_descricao?: string | null
          cnpj?: string | null
          cnpj_cache_fetched_at?: string | null
          complemento?: string | null
          created_at?: string
          email?: string | null
          id?: string
          logradouro?: string | null
          municipio?: string | null
          nome?: string
          nome_fantasia?: string | null
          numero?: string | null
          observacoes?: string | null
          pix_key?: string | null
          pix_key_type?: string | null
          razao_social?: string | null
          situacao_cadastral?: string | null
          source?: string | null
          telefone?: string | null
          uf?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      gastos: {
        Row: {
          ano: number
          cartao_id: string | null
          categoria_id: string | null
          confirmado: boolean
          created_at: string
          data: string
          descricao: string
          essencial: boolean | null
          estabelecimento: string
          forma_pagamento: string
          fornecedor_id: string | null
          gasto_fixo: boolean | null
          grupo_parcelamento_id: string | null
          horario: string | null
          id: string
          id_operacao_banco: string | null
          imagem_url: string | null
          import_batch_id: string | null
          invoice_month: string | null
          mes: number
          observacao: string | null
          offline_client_id: string | null
          origem: string | null
          parcela_atual: number | null
          recorrencia_id: string | null
          tipo_gasto: string
          total_parcelas: number | null
          updated_at: string
          user_id: string
          valor: number
        }
        Insert: {
          ano: number
          cartao_id?: string | null
          categoria_id?: string | null
          confirmado?: boolean
          created_at?: string
          data: string
          descricao: string
          essencial?: boolean | null
          estabelecimento?: string
          forma_pagamento: string
          fornecedor_id?: string | null
          gasto_fixo?: boolean | null
          grupo_parcelamento_id?: string | null
          horario?: string | null
          id?: string
          id_operacao_banco?: string | null
          imagem_url?: string | null
          import_batch_id?: string | null
          invoice_month?: string | null
          mes: number
          observacao?: string | null
          offline_client_id?: string | null
          origem?: string | null
          parcela_atual?: number | null
          recorrencia_id?: string | null
          tipo_gasto?: string
          total_parcelas?: number | null
          updated_at?: string
          user_id: string
          valor: number
        }
        Update: {
          ano?: number
          cartao_id?: string | null
          categoria_id?: string | null
          confirmado?: boolean
          created_at?: string
          data?: string
          descricao?: string
          essencial?: boolean | null
          estabelecimento?: string
          forma_pagamento?: string
          fornecedor_id?: string | null
          gasto_fixo?: boolean | null
          grupo_parcelamento_id?: string | null
          horario?: string | null
          id?: string
          id_operacao_banco?: string | null
          imagem_url?: string | null
          import_batch_id?: string | null
          invoice_month?: string | null
          mes?: number
          observacao?: string | null
          offline_client_id?: string | null
          origem?: string | null
          parcela_atual?: number | null
          recorrencia_id?: string | null
          tipo_gasto?: string
          total_parcelas?: number | null
          updated_at?: string
          user_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "gastos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
        ]
      }
      imported_transactions: {
        Row: {
          amount: number | null
          created_at: string
          currency: string | null
          description: string | null
          id: string
          integration_id: string | null
          occurred_at: string | null
          payment_method: string | null
          provider: string
          provider_transaction_id: string
          raw_payload: Json | null
          status: string | null
          title: string | null
          type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          description?: string | null
          id?: string
          integration_id?: string | null
          occurred_at?: string | null
          payment_method?: string | null
          provider: string
          provider_transaction_id: string
          raw_payload?: Json | null
          status?: string | null
          title?: string | null
          type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          description?: string | null
          id?: string
          integration_id?: string | null
          occurred_at?: string | null
          payment_method?: string | null
          provider?: string
          provider_transaction_id?: string
          raw_payload?: Json | null
          status?: string | null
          title?: string | null
          type?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "imported_transactions_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "user_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "imported_transactions_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "user_integrations_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      investimentos_ativos: {
        Row: {
          created_at: string
          data_inicio: string | null
          data_vencimento: string | null
          id: string
          importacao_id: string | null
          instituicao: string | null
          liquidez: string | null
          nome: string
          observacao: string | null
          origem: string | null
          preco_atual: number | null
          preco_medio: number | null
          quantidade: number | null
          rentabilidade_percentual: string | null
          rentabilidade_tipo: string | null
          ticker: string | null
          tipo: string
          ultima_atualizacao: string | null
          updated_at: string
          user_id: string
          valor_aplicado: number
          valor_atual: number
        }
        Insert: {
          created_at?: string
          data_inicio?: string | null
          data_vencimento?: string | null
          id?: string
          importacao_id?: string | null
          instituicao?: string | null
          liquidez?: string | null
          nome: string
          observacao?: string | null
          origem?: string | null
          preco_atual?: number | null
          preco_medio?: number | null
          quantidade?: number | null
          rentabilidade_percentual?: string | null
          rentabilidade_tipo?: string | null
          ticker?: string | null
          tipo?: string
          ultima_atualizacao?: string | null
          updated_at?: string
          user_id: string
          valor_aplicado?: number
          valor_atual?: number
        }
        Update: {
          created_at?: string
          data_inicio?: string | null
          data_vencimento?: string | null
          id?: string
          importacao_id?: string | null
          instituicao?: string | null
          liquidez?: string | null
          nome?: string
          observacao?: string | null
          origem?: string | null
          preco_atual?: number | null
          preco_medio?: number | null
          quantidade?: number | null
          rentabilidade_percentual?: string | null
          rentabilidade_tipo?: string | null
          ticker?: string | null
          tipo?: string
          ultima_atualizacao?: string | null
          updated_at?: string
          user_id?: string
          valor_aplicado?: number
          valor_atual?: number
        }
        Relationships: []
      }
      investimentos_atualizacoes: {
        Row: {
          ativo_id: string
          created_at: string
          data_atualizacao: string
          id: string
          observacao: string | null
          origem: string
          preco_anterior: number | null
          preco_novo: number | null
          user_id: string
          valor_anterior: number | null
          valor_novo: number | null
        }
        Insert: {
          ativo_id: string
          created_at?: string
          data_atualizacao?: string
          id?: string
          observacao?: string | null
          origem?: string
          preco_anterior?: number | null
          preco_novo?: number | null
          user_id: string
          valor_anterior?: number | null
          valor_novo?: number | null
        }
        Update: {
          ativo_id?: string
          created_at?: string
          data_atualizacao?: string
          id?: string
          observacao?: string | null
          origem?: string
          preco_anterior?: number | null
          preco_novo?: number | null
          user_id?: string
          valor_anterior?: number | null
          valor_novo?: number | null
        }
        Relationships: []
      }
      investimentos_importacoes: {
        Row: {
          arquivo_nome: string | null
          created_at: string
          dados_extraidos: Json | null
          erros: string | null
          id: string
          resumo: Json | null
          status: string
          tipo: string
          user_id: string
        }
        Insert: {
          arquivo_nome?: string | null
          created_at?: string
          dados_extraidos?: Json | null
          erros?: string | null
          id?: string
          resumo?: Json | null
          status?: string
          tipo: string
          user_id: string
        }
        Update: {
          arquivo_nome?: string | null
          created_at?: string
          dados_extraidos?: Json | null
          erros?: string | null
          id?: string
          resumo?: Json | null
          status?: string
          tipo?: string
          user_id?: string
        }
        Relationships: []
      }
      investimentos_movimentacoes: {
        Row: {
          ativo_id: string | null
          created_at: string
          data: string
          id: string
          importacao_id: string | null
          instituicao: string | null
          observacao: string | null
          origem: string | null
          quantidade: number | null
          tipo: string
          user_id: string
          valor_total: number
          valor_unitario: number | null
        }
        Insert: {
          ativo_id?: string | null
          created_at?: string
          data: string
          id?: string
          importacao_id?: string | null
          instituicao?: string | null
          observacao?: string | null
          origem?: string | null
          quantidade?: number | null
          tipo: string
          user_id: string
          valor_total?: number
          valor_unitario?: number | null
        }
        Update: {
          ativo_id?: string | null
          created_at?: string
          data?: string
          id?: string
          importacao_id?: string | null
          instituicao?: string | null
          observacao?: string | null
          origem?: string | null
          quantidade?: number | null
          tipo?: string
          user_id?: string
          valor_total?: number
          valor_unitario?: number | null
        }
        Relationships: []
      }
      investimentos_rendimentos: {
        Row: {
          ativo_id: string | null
          created_at: string
          data_pagamento: string
          id: string
          importacao_id: string | null
          observacao: string | null
          origem: string | null
          status: string
          tipo: string
          user_id: string
          valor: number
        }
        Insert: {
          ativo_id?: string | null
          created_at?: string
          data_pagamento: string
          id?: string
          importacao_id?: string | null
          observacao?: string | null
          origem?: string | null
          status?: string
          tipo?: string
          user_id: string
          valor?: number
        }
        Update: {
          ativo_id?: string | null
          created_at?: string
          data_pagamento?: string
          id?: string
          importacao_id?: string | null
          observacao?: string | null
          origem?: string | null
          status?: string
          tipo?: string
          user_id?: string
          valor?: number
        }
        Relationships: []
      }
      limites: {
        Row: {
          ano: number
          created_at: string
          id: string
          mes: number
          tipo: string
          updated_at: string
          user_id: string
          valor: number
        }
        Insert: {
          ano: number
          created_at?: string
          id?: string
          mes: number
          tipo: string
          updated_at?: string
          user_id: string
          valor: number
        }
        Update: {
          ano?: number
          created_at?: string
          id?: string
          mes?: number
          tipo?: string
          updated_at?: string
          user_id?: string
          valor?: number
        }
        Relationships: []
      }
      mercado_cestas_padrao: {
        Row: {
          created_at: string
          descricao: string | null
          id: string
          itens: Json
          nome: string
          tipo: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          descricao?: string | null
          id?: string
          itens?: Json
          nome?: string
          tipo?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          descricao?: string | null
          id?: string
          itens?: Json
          nome?: string
          tipo?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mercado_historico_compras: {
        Row: {
          budget: number | null
          concluida_em: string
          created_at: string
          economia_ou_estouro: number | null
          id: string
          itens_comprados: number
          itens_pendentes: number
          itens_snapshot: Json
          lista_id: string | null
          mercado_nome: string | null
          nome: string
          percentual_concluido: number
          tipo: string
          total_comprado_estimado: number
          total_estimado: number
          total_itens: number
          updated_at: string
          user_id: string
        }
        Insert: {
          budget?: number | null
          concluida_em: string
          created_at?: string
          economia_ou_estouro?: number | null
          id: string
          itens_comprados?: number
          itens_pendentes?: number
          itens_snapshot?: Json
          lista_id?: string | null
          mercado_nome?: string | null
          nome: string
          percentual_concluido?: number
          tipo: string
          total_comprado_estimado?: number
          total_estimado?: number
          total_itens?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          budget?: number | null
          concluida_em?: string
          created_at?: string
          economia_ou_estouro?: number | null
          id?: string
          itens_comprados?: number
          itens_pendentes?: number
          itens_snapshot?: Json
          lista_id?: string | null
          mercado_nome?: string | null
          nome?: string
          percentual_concluido?: number
          tipo?: string
          total_comprado_estimado?: number
          total_estimado?: number
          total_itens?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mercado_listas: {
        Row: {
          created_at: string
          entries: Json
          estimate: number | null
          id: string
          items_count: number
          name: string
          observation: string | null
          progress: number
          status: string
          tipo: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entries?: Json
          estimate?: number | null
          id?: string
          items_count?: number
          name?: string
          observation?: string | null
          progress?: number
          status?: string
          tipo?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entries?: Json
          estimate?: number | null
          id?: string
          items_count?: number
          name?: string
          observation?: string | null
          progress?: number
          status?: string
          tipo?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mercado_mercados_salvos: {
        Row: {
          bairro: string | null
          cep: string | null
          cidade: string | null
          created_at: string
          endereco: string | null
          favorito: boolean
          id: string
          nome: string
          observacao: string | null
          uf: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          created_at?: string
          endereco?: string | null
          favorito?: boolean
          id: string
          nome: string
          observacao?: string | null
          uf?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          created_at?: string
          endereco?: string | null
          favorito?: boolean
          id?: string
          nome?: string
          observacao?: string | null
          uf?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mercado_orcamentos: {
        Row: {
          atualizado_em: string
          created_at: string
          id: string
          mes_referencia: string
          updated_at: string
          user_id: string
          valor_mensal: number
        }
        Insert: {
          atualizado_em?: string
          created_at?: string
          id?: string
          mes_referencia: string
          updated_at?: string
          user_id: string
          valor_mensal?: number
        }
        Update: {
          atualizado_em?: string
          created_at?: string
          id?: string
          mes_referencia?: string
          updated_at?: string
          user_id?: string
          valor_mensal?: number
        }
        Relationships: []
      }
      mercado_precos_usuario: {
        Row: {
          categoria: string | null
          cidade: string | null
          codigo_barras: string | null
          comprado_em: string
          created_at: string
          estabelecimento: string | null
          from_paid_price: boolean
          historico_id: string
          id: string
          item_id: string | null
          lista_id: string | null
          marca: string | null
          nome_produto: string
          origem: string
          preco_total: number
          preco_unitario: number
          produto_key: string
          quantidade: number
          uf: string | null
          unidade: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          categoria?: string | null
          cidade?: string | null
          codigo_barras?: string | null
          comprado_em: string
          created_at?: string
          estabelecimento?: string | null
          from_paid_price?: boolean
          historico_id: string
          id: string
          item_id?: string | null
          lista_id?: string | null
          marca?: string | null
          nome_produto: string
          origem?: string
          preco_total?: number
          preco_unitario: number
          produto_key: string
          quantidade?: number
          uf?: string | null
          unidade?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          categoria?: string | null
          cidade?: string | null
          codigo_barras?: string | null
          comprado_em?: string
          created_at?: string
          estabelecimento?: string | null
          from_paid_price?: boolean
          historico_id?: string
          id?: string
          item_id?: string | null
          lista_id?: string | null
          marca?: string | null
          nome_produto?: string
          origem?: string
          preco_total?: number
          preco_unitario?: number
          produto_key?: string
          quantidade?: number
          uf?: string | null
          unidade?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      merchant_brand_aliases: {
        Row: {
          confidence: number | null
          created_at: string
          domain: string
          id: string
          merchant_name: string
          normalized_merchant_name: string
          source: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          domain: string
          id?: string
          merchant_name: string
          normalized_merchant_name: string
          source?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string
          domain?: string
          id?: string
          merchant_name?: string
          normalized_merchant_name?: string
          source?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      metas_financeiras: {
        Row: {
          banco_id: string | null
          color_hex: string
          created_at: string
          descricao: string | null
          id: string
          imagem_key: string | null
          legacy_id: string | null
          nome: string
          prazo: string | null
          updated_at: string
          user_id: string
          valor_atual: number
          valor_objetivo: number
        }
        Insert: {
          banco_id?: string | null
          color_hex?: string
          created_at?: string
          descricao?: string | null
          id?: string
          imagem_key?: string | null
          legacy_id?: string | null
          nome: string
          prazo?: string | null
          updated_at?: string
          user_id: string
          valor_atual?: number
          valor_objetivo?: number
        }
        Update: {
          banco_id?: string | null
          color_hex?: string
          created_at?: string
          descricao?: string | null
          id?: string
          imagem_key?: string | null
          legacy_id?: string | null
          nome?: string
          prazo?: string | null
          updated_at?: string
          user_id?: string
          valor_atual?: number
          valor_objetivo?: number
        }
        Relationships: [
          {
            foreignKeyName: "metas_financeiras_banco_id_fkey"
            columns: ["banco_id"]
            isOneToOne: false
            referencedRelation: "bancos"
            referencedColumns: ["id"]
          },
        ]
      }
      movimentacoes_meta: {
        Row: {
          banco_id: string | null
          created_at: string
          data: string
          id: string
          import_batch_id: string | null
          legacy_id: string | null
          meta_id: string
          observacao: string | null
          updated_at: string
          user_id: string
          valor: number
        }
        Insert: {
          banco_id?: string | null
          created_at?: string
          data?: string
          id?: string
          import_batch_id?: string | null
          legacy_id?: string | null
          meta_id: string
          observacao?: string | null
          updated_at?: string
          user_id: string
          valor?: number
        }
        Update: {
          banco_id?: string | null
          created_at?: string
          data?: string
          id?: string
          import_batch_id?: string | null
          legacy_id?: string | null
          meta_id?: string
          observacao?: string | null
          updated_at?: string
          user_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "movimentacoes_meta_banco_id_fkey"
            columns: ["banco_id"]
            isOneToOne: false
            referencedRelation: "bancos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_meta_meta_id_fkey"
            columns: ["meta_id"]
            isOneToOne: false
            referencedRelation: "metas_financeiras"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          created_at: string
          event_type: string | null
          external_payment_id: string
          id: string
          metadata: Json | null
          payment_id: string | null
          processed_at: string
          provider: string
          raw_status: string | null
          status: string
          subscription_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_type?: string | null
          external_payment_id: string
          id?: string
          metadata?: Json | null
          payment_id?: string | null
          processed_at?: string
          provider?: string
          raw_status?: string | null
          status: string
          subscription_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string | null
          external_payment_id?: string
          id?: string
          metadata?: Json | null
          payment_id?: string | null
          processed_at?: string
          provider?: string
          raw_status?: string | null
          status?: string
          subscription_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          cnpj: string | null
          cpf: string | null
          created_at: string
          id: string
          nome: string | null
          nome_fantasia: string | null
          razao_social: string | null
          responsavel_nome: string | null
          telefone: string | null
          timezone: string
          tipo_cadastro: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          cnpj?: string | null
          cpf?: string | null
          created_at?: string
          id: string
          nome?: string | null
          nome_fantasia?: string | null
          razao_social?: string | null
          responsavel_nome?: string | null
          telefone?: string | null
          timezone?: string
          tipo_cadastro?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          cnpj?: string | null
          cpf?: string | null
          created_at?: string
          id?: string
          nome?: string | null
          nome_fantasia?: string | null
          razao_social?: string | null
          responsavel_nome?: string | null
          telefone?: string | null
          timezone?: string
          tipo_cadastro?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rate_limit_events: {
        Row: {
          blocked: boolean
          created_at: string
          id: string
          ip_address: string | null
          key: string
          method: string | null
          route: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          blocked?: boolean
          created_at?: string
          id?: string
          ip_address?: string | null
          key: string
          method?: string | null
          route: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          blocked?: boolean
          created_at?: string
          id?: string
          ip_address?: string | null
          key?: string
          method?: string | null
          route?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      receitas: {
        Row: {
          ano: number
          cliente_id: string | null
          created_at: string
          data: string
          descricao: string
          horario: string | null
          id: string
          id_operacao_banco: string | null
          import_batch_id: string | null
          mes: number
          offline_client_id: string | null
          origem: string | null
          recorrencia_id: string | null
          recorrente: boolean
          tipo: string
          updated_at: string
          user_id: string
          valor: number
        }
        Insert: {
          ano: number
          cliente_id?: string | null
          created_at?: string
          data: string
          descricao: string
          horario?: string | null
          id?: string
          id_operacao_banco?: string | null
          import_batch_id?: string | null
          mes: number
          offline_client_id?: string | null
          origem?: string | null
          recorrencia_id?: string | null
          recorrente?: boolean
          tipo: string
          updated_at?: string
          user_id: string
          valor: number
        }
        Update: {
          ano?: number
          cliente_id?: string | null
          created_at?: string
          data?: string
          descricao?: string
          horario?: string | null
          id?: string
          id_operacao_banco?: string | null
          import_batch_id?: string | null
          mes?: number
          offline_client_id?: string | null
          origem?: string | null
          recorrencia_id?: string | null
          recorrente?: boolean
          tipo?: string
          updated_at?: string
          user_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "receitas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      recorrencias: {
        Row: {
          cartao_id: string | null
          categoria_id: string | null
          created_at: string
          detection_key: string | null
          forma_pagamento: string | null
          frequencia: string
          id: string
          moeda: string
          nome: string
          observacao: string | null
          origem: string
          proxima_cobranca: string | null
          status: string
          tipo_recorrencia: string
          ultimo_valor: number | null
          updated_at: string
          user_id: string
          valor: number
          valor_original: number | null
        }
        Insert: {
          cartao_id?: string | null
          categoria_id?: string | null
          created_at?: string
          detection_key?: string | null
          forma_pagamento?: string | null
          frequencia?: string
          id?: string
          moeda?: string
          nome: string
          observacao?: string | null
          origem?: string
          proxima_cobranca?: string | null
          status?: string
          tipo_recorrencia?: string
          ultimo_valor?: number | null
          updated_at?: string
          user_id: string
          valor?: number
          valor_original?: number | null
        }
        Update: {
          cartao_id?: string | null
          categoria_id?: string | null
          created_at?: string
          detection_key?: string | null
          forma_pagamento?: string | null
          frequencia?: string
          id?: string
          moeda?: string
          nome?: string
          observacao?: string | null
          origem?: string
          proxima_cobranca?: string | null
          status?: string
          tipo_recorrencia?: string
          ultimo_valor?: number | null
          updated_at?: string
          user_id?: string
          valor?: number
          valor_original?: number | null
        }
        Relationships: []
      }
      subscription_payments: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          discount_percent: number
          id: string
          method: string
          months: number
          paid_at: string | null
          payload: Json | null
          periodicidade: string
          plano: Database["public"]["Enums"]["plan_tier"]
          provider: string
          provider_payment_id: string | null
          qr_code: string | null
          qr_code_base64: string | null
          status: string
          ticket_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          discount_percent?: number
          id?: string
          method?: string
          months?: number
          paid_at?: string | null
          payload?: Json | null
          periodicidade?: string
          plano: Database["public"]["Enums"]["plan_tier"]
          provider?: string
          provider_payment_id?: string | null
          qr_code?: string | null
          qr_code_base64?: string | null
          status?: string
          ticket_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          discount_percent?: number
          id?: string
          method?: string
          months?: number
          paid_at?: string | null
          payload?: Json | null
          periodicidade?: string
          plano?: Database["public"]["Enums"]["plan_tier"]
          provider?: string
          provider_payment_id?: string | null
          qr_code?: string | null
          qr_code_base64?: string | null
          status?: string
          ticket_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      transferencias_internas: {
        Row: {
          ano: number
          created_at: string
          data: string
          descricao: string
          destino: string | null
          horario: string | null
          id: string
          id_operacao_banco: string | null
          import_batch_id: string | null
          mes: number
          observacao: string | null
          origem: string | null
          origem_importacao: string | null
          updated_at: string
          user_id: string
          valor: number
        }
        Insert: {
          ano: number
          created_at?: string
          data: string
          descricao?: string
          destino?: string | null
          horario?: string | null
          id?: string
          id_operacao_banco?: string | null
          import_batch_id?: string | null
          mes: number
          observacao?: string | null
          origem?: string | null
          origem_importacao?: string | null
          updated_at?: string
          user_id: string
          valor?: number
        }
        Update: {
          ano?: number
          created_at?: string
          data?: string
          descricao?: string
          destino?: string | null
          horario?: string | null
          id?: string
          id_operacao_banco?: string | null
          import_batch_id?: string | null
          mes?: number
          observacao?: string | null
          origem?: string | null
          origem_importacao?: string | null
          updated_at?: string
          user_id?: string
          valor?: number
        }
        Relationships: []
      }
      user_alerts: {
        Row: {
          action_label: string | null
          action_url: string | null
          created_at: string
          dedupe_key: string
          description: string | null
          id: string
          ignored_at: string | null
          metadata: Json
          period_key: string
          priority: string
          read_at: string | null
          related_entity_id: string | null
          related_entity_type: string | null
          resolved_at: string | null
          status: string
          title: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action_label?: string | null
          action_url?: string | null
          created_at?: string
          dedupe_key: string
          description?: string | null
          id?: string
          ignored_at?: string | null
          metadata?: Json
          period_key?: string
          priority?: string
          read_at?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          resolved_at?: string | null
          status?: string
          title: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action_label?: string | null
          action_url?: string | null
          created_at?: string
          dedupe_key?: string
          description?: string | null
          id?: string
          ignored_at?: string | null
          metadata?: Json
          period_key?: string
          priority?: string
          read_at?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          resolved_at?: string | null
          status?: string
          title?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_companies: {
        Row: {
          bairro: string | null
          cep: string | null
          cnae_principal_codigo: string | null
          cnae_principal_descricao: string | null
          cnpj: string
          cnpj_cache_fetched_at: string | null
          complemento: string | null
          created_at: string
          data_abertura: string | null
          id: string
          logradouro: string | null
          municipio: string | null
          natureza_juridica: string | null
          nome_fantasia: string | null
          numero: string | null
          porte: string | null
          razao_social: string | null
          situacao_cadastral: string | null
          source: string | null
          uf: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bairro?: string | null
          cep?: string | null
          cnae_principal_codigo?: string | null
          cnae_principal_descricao?: string | null
          cnpj: string
          cnpj_cache_fetched_at?: string | null
          complemento?: string | null
          created_at?: string
          data_abertura?: string | null
          id?: string
          logradouro?: string | null
          municipio?: string | null
          natureza_juridica?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          porte?: string | null
          razao_social?: string | null
          situacao_cadastral?: string | null
          source?: string | null
          uf?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bairro?: string | null
          cep?: string | null
          cnae_principal_codigo?: string | null
          cnae_principal_descricao?: string | null
          cnpj?: string
          cnpj_cache_fetched_at?: string | null
          complemento?: string | null
          created_at?: string
          data_abertura?: string | null
          id?: string
          logradouro?: string | null
          municipio?: string | null
          natureza_juridica?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          porte?: string | null
          razao_social?: string | null
          situacao_cadastral?: string | null
          source?: string | null
          uf?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_integrations: {
        Row: {
          access_token: string | null
          created_at: string
          expires_at: string | null
          id: string
          last_error: string | null
          last_sync_at: string | null
          provider: string
          provider_user_id: string | null
          refresh_token: string | null
          scope: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          provider: string
          provider_user_id?: string | null
          refresh_token?: string | null
          scope?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          provider?: string
          provider_user_id?: string | null
          refresh_token?: string | null
          scope?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_onboarding: {
        Row: {
          account_type: string | null
          created_at: string
          enabled_modules: string[]
          goals: string[]
          onboarding_completed: boolean
          onboarding_completed_at: string | null
          recommended_plan: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_type?: string | null
          created_at?: string
          enabled_modules?: string[]
          goals?: string[]
          onboarding_completed?: boolean
          onboarding_completed_at?: string | null
          recommended_plan?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_type?: string | null
          created_at?: string
          enabled_modules?: string[]
          goals?: string[]
          onboarding_completed?: boolean
          onboarding_completed_at?: string | null
          recommended_plan?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_plans: {
        Row: {
          access_until: string | null
          cancelled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          last_payment_id: string | null
          months: number | null
          periodicidade: string | null
          plano: Database["public"]["Enums"]["plan_tier"]
          status: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at: string | null
          trial_plan_type: string | null
          trial_started_at: string | null
          trial_used: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          access_until?: string | null
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          last_payment_id?: string | null
          months?: number | null
          periodicidade?: string | null
          plano?: Database["public"]["Enums"]["plan_tier"]
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at?: string | null
          trial_plan_type?: string | null
          trial_started_at?: string | null
          trial_used?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          access_until?: string | null
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          last_payment_id?: string | null
          months?: number | null
          periodicidade?: string | null
          plano?: Database["public"]["Enums"]["plan_tier"]
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at?: string | null
          trial_plan_type?: string | null
          trial_started_at?: string | null
          trial_used?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vault_entries: {
        Row: {
          category: string
          cipher_iv: string
          created_at: string
          favorite: boolean
          id: string
          name: string
          notes_cipher: string | null
          password_cipher: string | null
          password_strength: string
          password_updated_at: string | null
          site: string | null
          updated_at: string
          user_id: string
          username_cipher: string | null
        }
        Insert: {
          category?: string
          cipher_iv: string
          created_at?: string
          favorite?: boolean
          id?: string
          name: string
          notes_cipher?: string | null
          password_cipher?: string | null
          password_strength?: string
          password_updated_at?: string | null
          site?: string | null
          updated_at?: string
          user_id: string
          username_cipher?: string | null
        }
        Update: {
          category?: string
          cipher_iv?: string
          created_at?: string
          favorite?: boolean
          id?: string
          name?: string
          notes_cipher?: string | null
          password_cipher?: string | null
          password_strength?: string
          password_updated_at?: string | null
          site?: string | null
          updated_at?: string
          user_id?: string
          username_cipher?: string | null
        }
        Relationships: []
      }
      vault_pin_settings: {
        Row: {
          created_at: string
          failed_attempts: number
          iterations: number
          locked_until: string | null
          salt: string
          updated_at: string
          user_id: string
          wrap_iv: string
          wrapped_key: string
        }
        Insert: {
          created_at?: string
          failed_attempts?: number
          iterations?: number
          locked_until?: string | null
          salt: string
          updated_at?: string
          user_id: string
          wrap_iv: string
          wrapped_key: string
        }
        Update: {
          created_at?: string
          failed_attempts?: number
          iterations?: number
          locked_until?: string | null
          salt?: string
          updated_at?: string
          user_id?: string
          wrap_iv?: string
          wrapped_key?: string
        }
        Relationships: []
      }
      vault_settings: {
        Row: {
          created_at: string
          hint: string | null
          iterations: number
          salt: string
          updated_at: string
          user_id: string
          verifier: string
          verifier_iv: string
        }
        Insert: {
          created_at?: string
          hint?: string | null
          iterations?: number
          salt: string
          updated_at?: string
          user_id: string
          verifier: string
          verifier_iv: string
        }
        Update: {
          created_at?: string
          hint?: string | null
          iterations?: number
          salt?: string
          updated_at?: string
          user_id?: string
          verifier?: string
          verifier_iv?: string
        }
        Relationships: []
      }
      webhook_logs: {
        Row: {
          created_at: string
          error_message: string | null
          event_type: string | null
          external_id: string | null
          http_status: number | null
          id: string
          idempotency_key: string | null
          processing_time_ms: number | null
          provider: string
          related_email: string | null
          request_body: Json | null
          request_headers: Json | null
          response_body: Json | null
          status: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          event_type?: string | null
          external_id?: string | null
          http_status?: number | null
          id?: string
          idempotency_key?: string | null
          processing_time_ms?: number | null
          provider: string
          related_email?: string | null
          request_body?: Json | null
          request_headers?: Json | null
          response_body?: Json | null
          status: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          event_type?: string | null
          external_id?: string | null
          http_status?: number | null
          id?: string
          idempotency_key?: string | null
          processing_time_ms?: number | null
          provider?: string
          related_email?: string | null
          request_body?: Json | null
          request_headers?: Json | null
          response_body?: Json | null
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      whatsapp_beta_access: {
        Row: {
          ativo: boolean
          created_at: string
          expires_at: string | null
          granted_at: string
          granted_by: string | null
          id: string
          observacao: string | null
          revoked_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          expires_at?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          observacao?: string | null
          revoked_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          expires_at?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          observacao?: string | null
          revoked_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_links: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          opt_in_em: string | null
          opt_in_ip: string | null
          opt_in_user_agent: string | null
          opt_in_version: string | null
          revogado_em: string | null
          telefone: string
          ultimo_uso: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          opt_in_em?: string | null
          opt_in_ip?: string | null
          opt_in_user_agent?: string | null
          opt_in_version?: string | null
          revogado_em?: string | null
          telefone: string
          ultimo_uso?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          opt_in_em?: string | null
          opt_in_ip?: string | null
          opt_in_user_agent?: string | null
          opt_in_version?: string | null
          revogado_em?: string | null
          telefone?: string
          ultimo_uso?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_merchant_category_memories: {
        Row: {
          category_id: string
          confirmed_count: number
          created_at: string
          id: string
          last_confirmed_at: string
          manual_confirmed_count: number
          merchant_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category_id: string
          confirmed_count?: number
          created_at?: string
          id?: string
          last_confirmed_at?: string
          manual_confirmed_count?: number
          merchant_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category_id?: string
          confirmed_count?: number
          created_at?: string
          id?: string
          last_confirmed_at?: string
          manual_confirmed_count?: number
          merchant_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_merchant_category_memories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          confianca: number | null
          created_at: string
          erro: string | null
          external_id: string | null
          gasto_id: string | null
          id: string
          parsed: Json | null
          recebida_em: string
          resposta_sugerida: string | null
          status: string
          telefone: string
          texto: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          confianca?: number | null
          created_at?: string
          erro?: string | null
          external_id?: string | null
          gasto_id?: string | null
          id?: string
          parsed?: Json | null
          recebida_em?: string
          resposta_sugerida?: string | null
          status?: string
          telefone: string
          texto: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          confianca?: number | null
          created_at?: string
          erro?: string | null
          external_id?: string | null
          gasto_id?: string | null
          id?: string
          parsed?: Json | null
          recebida_em?: string
          resposta_sugerida?: string | null
          status?: string
          telefone?: string
          texto?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      whatsapp_notification_attempts: {
        Row: {
          attempt_status: string
          attempt_token: string
          claim_token: string
          client_reference: string
          created_at: string
          error_category: string | null
          error_code: string | null
          finished_at: string | null
          http_status: number | null
          id: string
          notification_id: string
          provider_message_id: string | null
          request_hash: string
          retryable: boolean | null
          started_at: string
          template_key: string
          template_language: string
          template_name: string
          updated_at: string
        }
        Insert: {
          attempt_status: string
          attempt_token?: string
          claim_token: string
          client_reference: string
          created_at?: string
          error_category?: string | null
          error_code?: string | null
          finished_at?: string | null
          http_status?: number | null
          id?: string
          notification_id: string
          provider_message_id?: string | null
          request_hash: string
          retryable?: boolean | null
          started_at?: string
          template_key: string
          template_language: string
          template_name: string
          updated_at?: string
        }
        Update: {
          attempt_status?: string
          attempt_token?: string
          claim_token?: string
          client_reference?: string
          created_at?: string
          error_category?: string | null
          error_code?: string | null
          finished_at?: string | null
          http_status?: number | null
          id?: string
          notification_id?: string
          provider_message_id?: string | null
          request_hash?: string
          retryable?: boolean | null
          started_at?: string
          template_key?: string
          template_language?: string
          template_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_notification_attempts_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_notification_preferences: {
        Row: {
          avisos_sistema: boolean
          contas_a_pagar: boolean
          created_at: string
          ia_insights: boolean
          mercado: boolean
          metas: boolean
          orcamento: boolean
          quiet_hours_end: number | null
          quiet_hours_start: number | null
          recorrencias: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          avisos_sistema?: boolean
          contas_a_pagar?: boolean
          created_at?: string
          ia_insights?: boolean
          mercado?: boolean
          metas?: boolean
          orcamento?: boolean
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          recorrencias?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          avisos_sistema?: boolean
          contas_a_pagar?: boolean
          created_at?: string
          ia_insights?: boolean
          mercado?: boolean
          metas?: boolean
          orcamento?: boolean
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          recorrencias?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_notification_status_events: {
        Row: {
          client_reference: string | null
          conversation_id: string | null
          error_category: string | null
          error_code: string | null
          error_message: string | null
          error_title: string | null
          event_at: string
          event_key: string
          event_status: string
          id: string
          notification_id: string | null
          phone_number_id: string | null
          pricing_category: string | null
          provider_message_id: string
          received_at: string
        }
        Insert: {
          client_reference?: string | null
          conversation_id?: string | null
          error_category?: string | null
          error_code?: string | null
          error_message?: string | null
          error_title?: string | null
          event_at: string
          event_key: string
          event_status: string
          id?: string
          notification_id?: string | null
          phone_number_id?: string | null
          pricing_category?: string | null
          provider_message_id: string
          received_at?: string
        }
        Update: {
          client_reference?: string | null
          conversation_id?: string | null
          error_category?: string | null
          error_code?: string | null
          error_message?: string | null
          error_title?: string | null
          event_at?: string
          event_key?: string
          event_status?: string
          id?: string
          notification_id?: string | null
          phone_number_id?: string | null
          pricing_category?: string | null
          provider_message_id?: string
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_notification_status_events_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_notification_templates: {
        Row: {
          active: boolean
          category: string
          created_at: string
          default_priority: string
          key: string
          meta_template_name: string | null
          payload_schema: Json
          requires_template_window: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          category: string
          created_at?: string
          default_priority?: string
          key: string
          meta_template_name?: string | null
          payload_schema?: Json
          requires_template_window?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          default_priority?: string
          key?: string
          meta_template_name?: string | null
          payload_schema?: Json
          requires_template_window?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_notifications: {
        Row: {
          attempt_count: number
          cancelled_at: string | null
          category: string
          claim_token: string | null
          claimed_at: string | null
          created_at: string
          dedupe_key: string
          delivered_at: string | null
          entity_id: string | null
          entity_type: string | null
          failed_at: string | null
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          max_attempts: number
          next_attempt_at: string | null
          notification_type: string
          payload: Json
          payload_version: number
          priority: string
          provider_message_id: string | null
          read_at: string | null
          scheduled_at: string
          sent_at: string | null
          skipped_reason: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          cancelled_at?: string | null
          category: string
          claim_token?: string | null
          claimed_at?: string | null
          created_at?: string
          dedupe_key: string
          delivered_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          failed_at?: string | null
          id?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          max_attempts?: number
          next_attempt_at?: string | null
          notification_type: string
          payload?: Json
          payload_version?: number
          priority?: string
          provider_message_id?: string | null
          read_at?: string | null
          scheduled_at: string
          sent_at?: string | null
          skipped_reason?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          cancelled_at?: string | null
          category?: string
          claim_token?: string | null
          claimed_at?: string | null
          created_at?: string
          dedupe_key?: string
          delivered_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          failed_at?: string | null
          id?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          max_attempts?: number
          next_attempt_at?: string | null
          notification_type?: string
          payload?: Json
          payload_version?: number
          priority?: string
          provider_message_id?: string | null
          read_at?: string | null
          scheduled_at?: string
          sent_at?: string | null
          skipped_reason?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_pix_pending_secrets: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          key_auth_tag: string
          key_ciphertext: string
          key_hash: string
          key_iv: string
          key_type: string
          session_message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          key_auth_tag: string
          key_ciphertext: string
          key_hash: string
          key_iv: string
          key_type: string
          session_message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          key_auth_tag?: string
          key_ciphertext?: string
          key_hash?: string
          key_iv?: string
          key_type?: string
          session_message_id?: string
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_pix_reveal_tokens: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          favorecido_id: string
          id: string
          pix_key_type: string
          token_hash: string
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          favorecido_id: string
          id?: string
          pix_key_type: string
          token_hash: string
          user_id: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          favorecido_id?: string
          id?: string
          pix_key_type?: string
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_pix_reveal_tokens_favorecido_id_fkey"
            columns: ["favorecido_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      contas_a_pagar_shared: {
        Row: {
          ano: number | null
          banco_emissor: string | null
          beneficiario: string | null
          categoria_id: string | null
          chave_pix: string | null
          codigo_boleto: string | null
          codigo_pix: string | null
          created_at: string | null
          data_fim: string | null
          data_inicio: string | null
          data_pagamento: string | null
          data_vencimento: string | null
          forma_pagamento: string | null
          fornecedor_id: string | null
          frequencia_recorrencia: string | null
          gasto_id: string | null
          id: string | null
          import_batch_id: string | null
          mes: number | null
          mes_referencia: string | null
          nome: string | null
          observacao: string | null
          recorrencia_id: string | null
          recorrente: boolean | null
          status: string | null
          updated_at: string | null
          user_id: string | null
          valor: number | null
        }
        Insert: {
          ano?: number | null
          banco_emissor?: string | null
          beneficiario?: string | null
          categoria_id?: string | null
          chave_pix?: never
          codigo_boleto?: never
          codigo_pix?: never
          created_at?: string | null
          data_fim?: string | null
          data_inicio?: string | null
          data_pagamento?: string | null
          data_vencimento?: string | null
          forma_pagamento?: string | null
          fornecedor_id?: string | null
          frequencia_recorrencia?: string | null
          gasto_id?: string | null
          id?: string | null
          import_batch_id?: string | null
          mes?: number | null
          mes_referencia?: string | null
          nome?: string | null
          observacao?: string | null
          recorrencia_id?: string | null
          recorrente?: boolean | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
          valor?: number | null
        }
        Update: {
          ano?: number | null
          banco_emissor?: string | null
          beneficiario?: string | null
          categoria_id?: string | null
          chave_pix?: never
          codigo_boleto?: never
          codigo_pix?: never
          created_at?: string | null
          data_fim?: string | null
          data_inicio?: string | null
          data_pagamento?: string | null
          data_vencimento?: string | null
          forma_pagamento?: string | null
          fornecedor_id?: string | null
          frequencia_recorrencia?: string | null
          gasto_id?: string | null
          id?: string | null
          import_batch_id?: string | null
          mes?: number | null
          mes_referencia?: string | null
          nome?: string | null
          observacao?: string | null
          recorrencia_id?: string | null
          recorrente?: boolean | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contas_a_pagar_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_a_pagar_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
        ]
      }
      user_integrations_safe: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string | null
          last_error: string | null
          last_sync_at: string | null
          provider: string | null
          provider_user_id: string | null
          status: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          provider?: string | null
          provider_user_id?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          provider?: string | null
          provider_user_id?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      account_access_level: {
        Args: { _owner: string }
        Returns: Database["public"]["Enums"]["connected_account_access"]
      }
      assert_free_ads_quota: {
        Args: { _resource: string; _user_id: string }
        Returns: undefined
      }
      can_admin_account: { Args: { _owner: string }; Returns: boolean }
      can_create_in_account: { Args: { _owner: string }; Returns: boolean }
      can_use_whatsapp: { Args: { _user_id: string }; Returns: boolean }
      can_view_account: { Args: { _owner: string }; Returns: boolean }
      claim_owner_if_first: { Args: never; Returns: boolean }
      connected_accounts_viewer_update_allowed: {
        Args: {
          p_new_accepted_at: string
          p_new_access_level: Database["public"]["Enums"]["connected_account_access"]
          p_new_invite_expires_at: string
          p_new_invite_token: string
          p_new_invited_email: string
          p_new_owner_user_id: string
          p_new_refused_at: string
          p_new_status: Database["public"]["Enums"]["connected_account_status"]
          p_new_viewer_user_id: string
          p_row_id: string
        }
        Returns: boolean
      }
      create_installment_purchase: {
        Args: {
          p_cartao_id: string
          p_categoria_id: string
          p_descricao: string
          p_estabelecimento: string
          p_grupo_id: string
          p_observacao: string
          p_origem: string
          p_parcelas: Json
          p_total_parcelas: number
          p_user_id: string
        }
        Returns: {
          id: string
          invoice_month: string
          parcela_atual: number
          valor: number
        }[]
      }
      create_recurring_income: {
        Args: {
          p_data: string
          p_descricao: string
          p_dia_mes?: number
          p_dia_semana?: number
          p_frequencia: string
          p_observacao?: string
          p_origem?: string
          p_tipo: string
          p_user_id: string
          p_valor: number
        }
        Returns: {
          proxima_cobranca: string
          receita_id: string
          recorrencia_id: string
        }[]
      }
      current_plan: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["plan_tier"]
      }
      current_user_email: { Args: never; Returns: string }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      fetch_invite_by_token: {
        Args: { _token: string }
        Returns: {
          accepted_at: string
          access_level: Database["public"]["Enums"]["connected_account_access"]
          id: string
          invite_expires_at: string
          invite_sent_at: string
          invited_email: string
          nickname: string
          owner_user_id: string
          refused_at: string
          removed_at: string
          status: Database["public"]["Enums"]["connected_account_status"]
          viewer_user_id: string
        }[]
      }
      has_active_plan_access: { Args: { _user_id: string }; Returns: boolean }
      has_basic_feature_access: {
        Args: { _feature: string; _user_id: string }
        Returns: boolean
      }
      has_feature_access: {
        Args: { _feature: string; _user_id: string }
        Returns: boolean
      }
      has_paid_plan_access: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin_email: { Args: { _email: string }; Returns: boolean }
      is_free_ads: { Args: { _user_id: string }; Returns: boolean }
      is_full_access: { Args: { _user_id: string }; Returns: boolean }
      is_owner: { Args: { _user_id: string }; Returns: boolean }
      list_my_pending_invites: {
        Args: never
        Returns: {
          accepted_at: string
          access_level: Database["public"]["Enums"]["connected_account_access"]
          id: string
          invite_expires_at: string
          invite_sent_at: string
          invited_email: string
          nickname: string
          owner_user_id: string
          refused_at: string
          removed_at: string
          status: Database["public"]["Enums"]["connected_account_status"]
          viewer_user_id: string
        }[]
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      rate_limit_hit: {
        Args: {
          _ip_address?: string
          _key: string
          _limit: number
          _method?: string
          _route: string
          _user_agent?: string
          _user_id?: string
          _window_seconds: number
        }
        Returns: {
          blocked: boolean
          current_count: number
          reset_at: string
        }[]
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      subscription_payment_email: { Args: { _payload: Json }; Returns: string }
      subscription_status_is_approved: {
        Args: { _status: string }
        Returns: boolean
      }
      subscription_status_is_failed: {
        Args: { _status: string }
        Returns: boolean
      }
      vault_pin_delete: { Args: never; Returns: undefined }
      vault_pin_record_attempt: {
        Args: { p_success: boolean }
        Returns: {
          failed_attempts: number
          locked_until: string
        }[]
      }
      vault_pin_set: {
        Args: {
          p_iterations: number
          p_salt: string
          p_wrap_iv: string
          p_wrapped_key: string
        }
        Returns: undefined
      }
      whatsapp_attempt_finalize_accepted_atomic: {
        Args: {
          p_attempt_id: string
          p_attempt_token: string
          p_finished_at?: string
          p_http_status: number
          p_provider_message_id: string
        }
        Returns: {
          outcome: string
        }[]
      }
      whatsapp_attempt_finalize_ambiguous_atomic: {
        Args: {
          p_attempt_id: string
          p_attempt_token: string
          p_error_code: string
          p_finished_at?: string
          p_http_status: number
        }
        Returns: {
          outcome: string
        }[]
      }
      whatsapp_attempt_finalize_rejected_atomic: {
        Args: {
          p_attempt_id: string
          p_attempt_token: string
          p_error_category: string
          p_error_code: string
          p_finished_at?: string
          p_http_status: number
          p_retryable: boolean
        }
        Returns: {
          outcome: string
        }[]
      }
      whatsapp_attempt_mark_sending_atomic: {
        Args: { p_attempt_id: string; p_attempt_token: string; p_now?: string }
        Returns: {
          outcome: string
        }[]
      }
      whatsapp_attempt_prepare_atomic: {
        Args: {
          p_attempt_token: string
          p_claim_token: string
          p_client_reference: string
          p_notification_id: string
          p_now?: string
          p_request_hash: string
          p_template_key: string
          p_template_language: string
          p_template_name: string
        }
        Returns: {
          attempt_id: string
          outcome: string
        }[]
      }
      whatsapp_attempt_reconcile_callback_atomic: {
        Args: {
          p_client_reference: string
          p_event_at?: string
          p_event_status: string
          p_provider_message_id: string
        }
        Returns: {
          attempt_id: string
          notification_id: string
          outcome: string
        }[]
      }
      whatsapp_baixa_conta_atomic: {
        Args: {
          p_conta_id: string
          p_data_pagamento: string
          p_origem?: string
          p_user_id: string
        }
        Returns: {
          data_pagamento: string
          gasto_id: string
          nome: string
          result: string
          valor: number
        }[]
      }
      whatsapp_notification_recover_with_attempt_atomic: {
        Args: { p_backoff?: string; p_notification_id: string; p_now?: string }
        Returns: {
          outcome: string
        }[]
      }
    }
    Enums: {
      app_role: "owner" | "admin" | "user"
      connected_account_access: "view" | "view_create" | "admin"
      connected_account_status:
        | "pending"
        | "accepted"
        | "refused"
        | "removed"
        | "expired"
      plan_tier:
        | "free"
        | "pessoal"
        | "mei"
        | "empresa"
        | "admin_master"
        | "pessoal_manual"
        | "pessoal_premium"
        | "mei_essencial"
        | "mei_inteligente"
        | "sem_assinatura"
        | "free_ads"
      subscription_status:
        | "ativo"
        | "teste"
        | "expirado"
        | "cancelado"
        | "sem_assinatura"
        | "aguardando_pagamento"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner", "admin", "user"],
      connected_account_access: ["view", "view_create", "admin"],
      connected_account_status: [
        "pending",
        "accepted",
        "refused",
        "removed",
        "expired",
      ],
      plan_tier: [
        "free",
        "pessoal",
        "mei",
        "empresa",
        "admin_master",
        "pessoal_manual",
        "pessoal_premium",
        "mei_essencial",
        "mei_inteligente",
        "sem_assinatura",
        "free_ads",
      ],
      subscription_status: [
        "ativo",
        "teste",
        "expirado",
        "cancelado",
        "sem_assinatura",
        "aguardando_pagamento",
      ],
    },
  },
} as const
