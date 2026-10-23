export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  "public": {
    Tables: {
      "albums": {
        Row: {
          "created_at": string;
          "id": string;
          "owner_id": string;
          "qr_preset_id": number;
          "sort_order": number;
          "title": string;
        };
        ComputedFields: never;
        Insert: {
          "created_at"?: string;
          "id"?: string;
          "owner_id"?: string;
          "qr_preset_id"?: number;
          "sort_order"?: number;
          "title": string;
        };
        Update: {
          "created_at"?: string;
          "id"?: string;
          "owner_id"?: string;
          "qr_preset_id"?: number;
          "sort_order"?: number;
          "title"?: string;
        };
        Relationships: [];
      };
      "profiles": {
        Row: {
          "created_at": string;
          "deletion_requested_at": string | null;
          "display_name": string;
          "owner_id": string;
        };
        ComputedFields: never;
        Insert: {
          "created_at"?: string;
          "deletion_requested_at"?: string | null;
          "display_name"?: string;
          "owner_id"?: string;
        };
        Update: {
          "created_at"?: string;
          "deletion_requested_at"?: string | null;
          "display_name"?: string;
          "owner_id"?: string;
        };
        Relationships: [];
      };
      "spike_items": {
        Row: {
          "caption": string;
          "id": string;
          "owner_id": string;
          "share_token": string;
          "sharing_enabled": boolean;
          "video_id": string;
        };
        ComputedFields: never;
        Insert: {
          "caption": string;
          "id"?: string;
          "owner_id"?: string;
          "share_token"?: string;
          "sharing_enabled"?: boolean;
          "video_id": string;
        };
        Update: {
          "caption"?: string;
          "id"?: string;
          "owner_id"?: string;
          "share_token"?: string;
          "sharing_enabled"?: boolean;
          "video_id"?: string;
        };
        Relationships: [];
      };
      "upload_jobs": {
        Row: {
          "album_id": string;
          "anonymous_playback_verified_at": string | null;
          "channel_verified": boolean;
          "created_at": string;
          "effective_visibility": string | null;
          "id": string;
          "idempotency_key": string;
          "owner_id": string;
          "processing_status": string;
          "provider_video_id": string | null;
          "public_confirmed_at": string | null;
          "requested_visibility": string;
          "state": string;
          "upload_description": string;
          "upload_title": string;
          "verified_at": string | null;
          "verified_duration_seconds": number | null;
          "verified_size_bytes": number | null;
          "video_id": string;
          "workflow_id": string;
        };
        ComputedFields: never;
        Insert: {
          "album_id": string;
          "anonymous_playback_verified_at"?: string | null;
          "channel_verified"?: boolean;
          "created_at"?: string;
          "effective_visibility"?: string | null;
          "id"?: string;
          "idempotency_key": string;
          "owner_id": string;
          "processing_status"?: string;
          "provider_video_id"?: string | null;
          "public_confirmed_at"?: string | null;
          "requested_visibility"?: string;
          "state"?: string;
          "upload_description"?: string;
          "upload_title": string;
          "verified_at"?: string | null;
          "verified_duration_seconds"?: number | null;
          "verified_size_bytes"?: number | null;
          "video_id": string;
          "workflow_id": string;
        };
        Update: {
          "album_id"?: string;
          "anonymous_playback_verified_at"?: string | null;
          "channel_verified"?: boolean;
          "created_at"?: string;
          "effective_visibility"?: string | null;
          "id"?: string;
          "idempotency_key"?: string;
          "owner_id"?: string;
          "processing_status"?: string;
          "provider_video_id"?: string | null;
          "public_confirmed_at"?: string | null;
          "requested_visibility"?: string;
          "state"?: string;
          "upload_description"?: string;
          "upload_title"?: string;
          "verified_at"?: string | null;
          "verified_duration_seconds"?: number | null;
          "verified_size_bytes"?: number | null;
          "video_id"?: string;
          "workflow_id"?: string;
        };
        Relationships: [
          {
            foreignKeyName: "upload_jobs_video_id_album_id_owner_id_fkey";
            columns: ["video_id", "album_id", "owner_id"];
            isOneToOne: false;
            referencedRelation: "videos";
            referencedColumns: ["id", "album_id", "owner_id"];
          },
          {
            foreignKeyName: "upload_jobs_workflow_id_album_id_owner_id_fkey";
            columns: ["workflow_id", "album_id", "owner_id"];
            isOneToOne: false;
            referencedRelation: "upload_workflows";
            referencedColumns: ["id", "album_id", "owner_id"];
          },
        ];
      };
      "upload_workflows": {
        Row: {
          "album_id": string;
          "created_at": string;
          "expires_at": string;
          "id": string;
          "owner_id": string;
        };
        ComputedFields: never;
        Insert: {
          "album_id": string;
          "created_at"?: string;
          "expires_at"?: string;
          "id"?: string;
          "owner_id"?: string;
        };
        Update: {
          "album_id"?: string;
          "created_at"?: string;
          "expires_at"?: string;
          "id"?: string;
          "owner_id"?: string;
        };
        Relationships: [
          {
            foreignKeyName: "upload_workflows_album_id_owner_id_fkey";
            columns: ["album_id", "owner_id"];
            isOneToOne: false;
            referencedRelation: "albums";
            referencedColumns: ["id", "owner_id"];
          },
        ];
      };
      "videos": {
        Row: {
          "album_id": string;
          "caption": string;
          "created_at": string;
          "id": string;
          "owner_id": string;
          "sort_order": number;
        };
        ComputedFields: never;
        Insert: {
          "album_id": string;
          "caption"?: string;
          "created_at"?: string;
          "id"?: string;
          "owner_id"?: string;
          "sort_order"?: number;
        };
        Update: {
          "album_id"?: string;
          "caption"?: string;
          "created_at"?: string;
          "id"?: string;
          "owner_id"?: string;
          "sort_order"?: number;
        };
        Relationships: [
          {
            foreignKeyName: "videos_album_id_owner_id_fkey";
            columns: ["album_id", "owner_id"];
            isOneToOne: false;
            referencedRelation: "albums";
            referencedColumns: ["id", "owner_id"];
          },
        ];
      };
      "youtube_connections": {
        Row: {
          "channel_id": string;
          "channel_title": string;
          "owner_id": string;
          "verified_at": string;
          "workflow_id": string;
        };
        ComputedFields: never;
        Insert: {
          "channel_id": string;
          "channel_title": string;
          "owner_id": string;
          "verified_at": string;
          "workflow_id": string;
        };
        Update: {
          "channel_id"?: string;
          "channel_title"?: string;
          "owner_id"?: string;
          "verified_at"?: string;
          "workflow_id"?: string;
        };
        Relationships: [
          {
            foreignKeyName: "youtube_connections_workflow_id_owner_id_fkey";
            columns: ["workflow_id", "owner_id"];
            isOneToOne: false;
            referencedRelation: "upload_workflows";
            referencedColumns: ["id", "owner_id"];
          },
        ];
      };
    };
    Views: {
      "qr_ready_uploads": {
        Row: {
          "effective_visibility": string | null;
          "id": string | null;
          "owner_id": string | null;
          "provider_video_id": string | null;
          "verified_at": string | null;
          "video_id": string | null;
          "workflow_id": string | null;
        };
        ComputedFields: never;
        Relationships: [];
      };
    };
    Functions: {
      "consume_upload_oauth": {
        Args: { "p_hash": string; "p_owner": string; "p_workflow": string };
        Returns: {
          "key_id": string;
          "verifier_cipher": string;
        }[];
      };
      "finish_upload_workflow": {
        Args: { "p_owner": string; "p_workflow": string };
        Returns: boolean;
      };
      "purge_expired_upload_data": { Args: { "p_before"?: string }; Returns: undefined };
      "request_upload": {
        Args: {
          "p_confirm_public"?: boolean;
          "p_idempotency_key": string;
          "p_requested_visibility"?: string;
          "p_upload_description"?: string;
          "p_upload_title": string;
          "p_video_id": string;
          "p_workflow_id": string;
        };
        Returns: string;
      };
      "resolve_spike_share": {
        Args: { "token": string };
        Returns: {
          "video_id": string;
        }[];
      };
      "yt_probe_clear_job": { Args: { "p_owner": string }; Returns: undefined };
      "yt_probe_consume": {
        Args: { "p_hash": string; "p_owner": string };
        Returns: {
          "verifier": string;
        }[];
      };
      "yt_probe_credentials": {
        Args: { "p_owner": string };
        Returns: {
          "channel_id": string;
          "channel_title": string;
          "refresh_cipher": string;
        }[];
      };
      "yt_probe_forget": { Args: { "p_owner": string }; Returns: undefined };
      "yt_probe_job": {
        Args: { "p_owner": string };
        Returns: {
          "created_at": string;
          "file_sha256": string;
          "job_id": string;
          "session_cipher": string;
          "size_bytes": number;
        }[];
      };
      "yt_probe_reserve": {
        Args: { "p_hash": string; "p_job": string; "p_owner": string; "p_size": number };
        Returns: undefined;
      };
      "yt_probe_save": {
        Args: { "p_channel": string; "p_cipher": string; "p_owner": string; "p_title": string };
        Returns: undefined;
      };
      "yt_probe_session": {
        Args: { "p_cipher": string; "p_job": string; "p_owner": string };
        Returns: undefined;
      };
      "yt_probe_start": {
        Args: { "p_hash": string; "p_owner": string; "p_verifier": string };
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof (
      & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
      & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"]
    )
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? (
    & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"]
  )[TableName] extends {
    Row: infer R;
  } ? R
  : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R;
    } ? R
    : never
  : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends
    {
      Insert: infer I;
    } ? I
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I;
    } ? I
    : never
  : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends
    {
      Update: infer U;
    } ? U
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U;
    } ? U
    : never
  : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][
    CompositeTypeName
  ]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never;

export const Constants = {
  "public": {
    Enums: {},
  },
} as const;
