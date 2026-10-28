CREATE TABLE "public"."account_entries" (
  "id"             uuid    NOT NULL DEFAULT gen_random_uuid(),
  "budget_id"      uuid    NOT NULL,
  "transaction_id" uuid    NOT NULL,
  "account_id"     uuid    NOT NULL,
  "amount_minor"   bigint  NOT NULL,
  "position"       integer NOT NULL,
  CONSTRAINT "account_entries_amount_minor_check" CHECK ((amount_minor <> 0)),
  CONSTRAINT "account_entries_pkey" PRIMARY KEY (id),
  CONSTRAINT "account_entries_position_check" CHECK (("position" >= 0)),
  CONSTRAINT "account_entries_transaction_id_position_key" UNIQUE (transaction_id, "position"),
  CONSTRAINT "account_entries_budget_id_account_id_fkey" FOREIGN KEY (budget_id, account_id) REFERENCES public.accounts(budget_id, id),
  CONSTRAINT "account_entries_budget_id_transaction_id_fkey" FOREIGN KEY (budget_id, transaction_id) REFERENCES public.transactions(budget_id, id)
);

ALTER TABLE "public"."account_entries"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX account_entries_account ON public.account_entries USING btree (budget_id, account_id, transaction_id);

CREATE INDEX account_entries_parent ON public.account_entries USING btree (budget_id, transaction_id);

CREATE CONSTRAINT TRIGGER validate_aggregate
  AFTER INSERT OR DELETE OR UPDATE ON public.account_entries DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION budgie_private.check_aggregate();

CREATE POLICY "owner_read" ON "public"."account_entries"
  FOR SELECT
  TO "authenticated"
  USING (budgie_private.is_owner(budget_id));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."account_entries" TO "service_role";

REVOKE ALL ON TABLE "public"."account_entries" FROM "authenticated";

GRANT SELECT ON TABLE "public"."account_entries" TO "authenticated";

REVOKE ALL ON TABLE "public"."account_entries" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."account_entries" TO "postgres";

REVOKE ALL ON TABLE "public"."account_entries" FROM "anon";
