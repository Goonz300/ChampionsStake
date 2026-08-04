// supabase/functions/_shared/database/repository.ts
//
// A thin generic repository base class over the Supabase JS client. This is
// intentionally minimal — it exists to standardize the shape of "find by
// id / list / insert / update" across future domain repositories (a future
// WalletRepository, ChallengeRepository, etc. each extend this), not to be
// a full ORM. No domain-specific repository is created in this phase.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { NotFoundError } from "../errors/index.ts";

export abstract class Repository<TRow extends { id: string }> {
  constructor(
    protected readonly client: SupabaseClient,
    protected readonly tableName: string,
  ) {}

  async findById(id: string): Promise<TRow> {
    const { data, error } = await this.client.from(this.tableName).select("*").eq("id", id).single();

    if (error || !data) {
      throw new NotFoundError(`${this.tableName} with id "${id}" was not found.`);
    }
    return data as TRow;
  }

  async findByIdOrNull(id: string): Promise<TRow | null> {
    const { data } = await this.client.from(this.tableName).select("*").eq("id", id).maybeSingle();
    return (data as TRow | null) ?? null;
  }

  async list(filters: Partial<TRow> = {}, options: { limit?: number; cursor?: string } = {}): Promise<TRow[]> {
    let query = this.client.from(this.tableName).select("*");

    for (const [key, value] of Object.entries(filters)) {
      query = query.eq(key, value as string | number | boolean);
    }

    if (options.cursor) {
      query = query.gt("id", options.cursor);
    }

    query = query.order("id", { ascending: true }).limit(options.limit ?? 20);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list ${this.tableName}: ${error.message}`);
    return (data as TRow[]) ?? [];
  }

  async insert(row: Partial<TRow>): Promise<TRow> {
    const { data, error } = await this.client.from(this.tableName).insert(row).select("*").single();
    if (error || !data) throw new Error(`Failed to insert into ${this.tableName}: ${error?.message}`);
    return data as TRow;
  }

  async update(id: string, patch: Partial<TRow>): Promise<TRow> {
    const { data, error } = await this.client
      .from(this.tableName)
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) throw new Error(`Failed to update ${this.tableName} id=${id}: ${error?.message}`);
    return data as TRow;
  }
}
