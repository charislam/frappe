CREATE TABLE "public"."account_balances" (
  "budget_id"     uuid   NOT NULL,
  "account_id"    uuid   NOT NULL,
  "balance_minor" bigint NOT NULL,
  CONSTRAINT "account_balances_pkey" PRIMARY KEY (budget_id, account_id),
  CONSTRAINT "account_balances_budget_id_account_id_fkey" FOREIGN KEY (budget_id, account_id) REFERENCES public.accounts(budget_id, id)
);

ALTER TABLE "public"."account_balances"
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_read" ON "public"."account_balances"
  FOR SELECT
  TO "authenticated"
  USING (budgie_private.is_owner(budget_id));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."account_balances" TO "service_role";

REVOKE ALL ON TABLE "public"."account_balances" FROM "authenticated";

GRANT SELECT ON TABLE "public"."account_balances" TO "authenticated";

REVOKE ALL ON TABLE "public"."account_balances" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."account_balances" TO "postgres";

REVOKE ALL ON TABLE "public"."account_balances" FROM "anon";
