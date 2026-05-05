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
          frequencia_recorrencia: string | null
          gasto_id: string | null
          id: string
          import_batch_id: string | null
          mes: number
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
          frequencia_recorrencia?: string | null
          gasto_id?: string | null
          id?: string
          import_batch_id?: string | null
          mes: number
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
          frequencia_recorrencia?: string | null
          gasto_id?: string | null
          id?: string
          import_batch_id?: string | null
          mes?: number
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
        ]
      }
      contas_a_receber: {
        Row: {
          categoria: string | null
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
        Relationships: []
      }
      dinheiro_guardado: {
        Row: {
          banco_id: string | null
          created_at: string
          data_atualizacao: string
          id: string
          import_batch_id: string | null
          legacy_id: string | null
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
      profiles: {
        Row: {
          cnpj: string | null
          cpf: string | null
          created_at: string
          id: string
          nome: string | null
          nome_fantasia: string | null
          razao_social: string | null
          responsavel_nome: string | null
          telefone: string | null
          tipo_cadastro: string | null
          updated_at: string
        }
        Insert: {
          cnpj?: string | null
          cpf?: string | null
          created_at?: string
          id: string
          nome?: string | null
          nome_fantasia?: string | null
          razao_social?: string | null
          responsavel_nome?: string | null
          telefone?: string | null
          tipo_cadastro?: string | null
          updated_at?: string
        }
        Update: {
          cnpj?: string | null
          cpf?: string | null
          created_at?: string
          id?: string
          nome?: string | null
          nome_fantasia?: string | null
          razao_social?: string | null
          responsavel_nome?: string | null
          telefone?: string | null
          tipo_cadastro?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      receitas: {
        Row: {
          ano: number
          created_at: string
          data: string
          descricao: string
          horario: string | null
          id: string
          id_operacao_banco: string | null
          import_batch_id: string | null
          mes: number
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
          created_at?: string
          data: string
          descricao: string
          horario?: string | null
          id?: string
          id_operacao_banco?: string | null
          import_batch_id?: string | null
          mes: number
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
          created_at?: string
          data?: string
          descricao?: string
          horario?: string | null
          id?: string
          id_operacao_banco?: string | null
          import_batch_id?: string | null
          mes?: number
          origem?: string | null
          recorrencia_id?: string | null
          recorrente?: boolean
          tipo?: string
          updated_at?: string
          user_id?: string
          valor?: number
        }
        Relationships: []
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
        }
        Insert: {
          cartao_id?: string | null
          categoria_id?: string | null
          created_at?: string
          detection_key?: string | null
          forma_pagamento?: string | null
          frequencia?: string
          id?: string
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
        }
        Update: {
          cartao_id?: string | null
          categoria_id?: string | null
          created_at?: string
          detection_key?: string | null
          forma_pagamento?: string | null
          frequencia?: string
          id?: string
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
      whatsapp_links: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          telefone: string
          ultimo_uso: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          telefone: string
          ultimo_uso?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          telefone?: string
          ultimo_uso?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_owner_if_first: { Args: never; Returns: boolean }
      current_plan: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["plan_tier"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin_email: { Args: { _email: string }; Returns: boolean }
      is_full_access: { Args: { _user_id: string }; Returns: boolean }
      is_owner: { Args: { _user_id: string }; Returns: boolean }
      subscription_payment_email: { Args: { _payload: Json }; Returns: string }
      subscription_status_is_approved: {
        Args: { _status: string }
        Returns: boolean
      }
      subscription_status_is_failed: {
        Args: { _status: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "owner" | "admin" | "user"
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
