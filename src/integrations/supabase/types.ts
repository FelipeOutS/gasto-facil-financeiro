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
          created_at: string
          id: string
          nome: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          nome?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          nome?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
