CREATE TABLE "public"."allocation_entries" (
  "id"           uuid   NOT NULL DEFAULT gen_random_uuid(),
  "budget_id"    uuid   NOT NULL,
  "batch_id"     uuid   NOT NULL,
  "envelope_id"  uuid   NOT NULL,
  "amount_minor" bigint NOT NULL,
  CONSTRAINT "allocation_entries_amount_minor_check" CHECK ((amount_minor <> 0)),
  CONSTRAINT "allocation_entries_batch_id_envelope_id_key" UNIQUE (batch_id, envelope_id),
  CONSTRAINT "allocation_entries_budget_id_batch_id_fkey" FOREIGN KEY (budget_id, batch_id) REFERENCES public.allocation_batches(budget_id, id),
  CONSTRAINT "allocation_entries_pkey" PRIMARY KEY (id),
  CONSTRAINT "allocation_entries_budget_id_envelope_id_fkey" FOREIGN KEY (budget_id, envelope_id) REFERENCES public.envelopes(budget_id, id)
);

ALTER TABLE "public"."allocation_entries"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX allocation_entries_envelope ON public.allocation_entries USING btree (budget_id, envelope_id);

CREATE INDEX allocation_entries_parent ON public.allocation_entries USING btree (budget_id, batch_id);

CREATE CONSTRAINT TRIGGER validate_aggregate
  AFTER INSERT OR DELETE OR UPDATE ON public.allocation_entries DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION budgie_private.check_aggregate();

CREATE POLICY "owner_read" ON "public"."allocation_entries"
  FOR SELECT
  TO "authenticated"
  USING (budgie_private.is_owner(budget_id));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."allocation_entries" TO "service_role";

REVOKE ALL ON TABLE "public"."allocation_entries" FROM "authenticated";

GRANT SELECT ON TABLE "public"."allocation_entries" TO "authenticated";

REVOKE ALL ON TABLE "public"."allocation_entries" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."allocation_entries" TO "postgres";

REVOKE ALL ON TABLE "public"."allocation_entries" FROM "anon";
