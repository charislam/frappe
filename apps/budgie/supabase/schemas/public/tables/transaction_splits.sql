CREATE TABLE "public"."transaction_splits" (
  "id"             uuid    NOT NULL DEFAULT gen_random_uuid(),
  "budget_id"      uuid    NOT NULL,
  "transaction_id" uuid    NOT NULL,
  "envelope_id"    uuid    NOT NULL,
  "amount_minor"   bigint  NOT NULL,
  "position"       integer NOT NULL,
  CONSTRAINT "transaction_splits_amount_minor_check" CHECK ((amount_minor <> 0)),
  CONSTRAINT "transaction_splits_budget_id_envelope_id_fkey" FOREIGN KEY (budget_id, envelope_id) REFERENCES public.envelopes(budget_id, id),
  CONSTRAINT "transaction_splits_pkey" PRIMARY KEY (id),
  CONSTRAINT "transaction_splits_position_check" CHECK (("position" >= 0)),
  CONSTRAINT "transaction_splits_transaction_id_position_key" UNIQUE (transaction_id, "position"),
  CONSTRAINT "transaction_splits_budget_id_transaction_id_fkey" FOREIGN KEY (budget_id, transaction_id) REFERENCES public.transactions(budget_id, id)
);

ALTER TABLE "public"."transaction_splits"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX transaction_splits_envelope ON public.transaction_splits USING btree (budget_id, envelope_id);

CREATE INDEX transaction_splits_parent ON public.transaction_splits USING btree (budget_id, transaction_id);

CREATE CONSTRAINT TRIGGER validate_aggregate
  AFTER INSERT OR DELETE OR UPDATE ON public.transaction_splits DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION budgie_private.check_aggregate();

CREATE POLICY "owner_read" ON "public"."transaction_splits"
  FOR SELECT
  TO "authenticated"
  USING (budgie_private.is_owner(budget_id));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."transaction_splits" TO "service_role";

REVOKE ALL ON TABLE "public"."transaction_splits" FROM "authenticated";

GRANT SELECT ON TABLE "public"."transaction_splits" TO "authenticated";

REVOKE ALL ON TABLE "public"."transaction_splits" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."transaction_splits" TO "postgres";

REVOKE ALL ON TABLE "public"."transaction_splits" FROM "anon";
