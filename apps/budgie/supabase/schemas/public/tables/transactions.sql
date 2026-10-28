CREATE TABLE "public"."transactions" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "budget_id"      uuid                     NOT NULL,
  "kind"           text                     NOT NULL,
  "status"         text                     NOT NULL,
  "effective_date" date                     NOT NULL,
  "payee_id"       uuid,
  "memo"           text,
  "sequence"       bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "version"        bigint                   NOT NULL DEFAULT 1,
  "created_by"     uuid                     NOT NULL,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "transactions_budget_id_fkey" FOREIGN KEY (budget_id) REFERENCES public.budgets(id),
  CONSTRAINT "transactions_budget_id_id_key" UNIQUE (budget_id, id),
  CONSTRAINT "transactions_budget_id_payee_id_fkey" FOREIGN KEY (budget_id, payee_id) REFERENCES public.payees(budget_id, id),
  CONSTRAINT "transactions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT "transactions_kind_check"
    CHECK ((kind = ANY (ARRAY['income'::text, 'expense'::text, 'refund'::text, 'transfer'::text, 'opening_balance'::text, 'adjustment'::text, 'valuation'::text]))),
  CONSTRAINT "transactions_pkey" PRIMARY KEY (id),
  CONSTRAINT "transactions_sequence_key" UNIQUE (SEQUENCE),
  CONSTRAINT "transactions_status_check" CHECK ((status = ANY (ARRAY['scheduled'::text, 'posted'::text, 'voided'::text]))),
  CONSTRAINT "transactions_version_check" CHECK ((version > 0))
);

ALTER TABLE "public"."transactions"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX transactions_payee ON public.transactions USING btree (budget_id, payee_id);

CREATE INDEX transactions_posted ON public.transactions USING btree (budget_id, effective_date, SEQUENCE)
  WHERE (status = 'posted'::text);

CREATE INDEX transactions_scheduled ON public.transactions USING btree (budget_id, effective_date)
  WHERE (status = 'scheduled'::text);

CREATE TRIGGER protect_identity
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION budgie_private.protect_identity();

CREATE CONSTRAINT TRIGGER validate_aggregate
  AFTER INSERT OR DELETE OR UPDATE ON public.transactions DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION budgie_private.check_aggregate();

CREATE POLICY "owner_read" ON "public"."transactions"
  FOR SELECT
  TO "authenticated"
  USING (budgie_private.is_owner(budget_id));

REVOKE ALL ON SEQUENCE "public"."transactions_sequence_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."transactions_sequence_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."transactions_sequence_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."transactions_sequence_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."transactions_sequence_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."transactions_sequence_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."transactions_sequence_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."transactions_sequence_seq" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."transactions" TO "service_role";

REVOKE ALL ON TABLE "public"."transactions" FROM "authenticated";

GRANT SELECT ON TABLE "public"."transactions" TO "authenticated";

REVOKE ALL ON TABLE "public"."transactions" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."transactions" TO "postgres";

REVOKE ALL ON TABLE "public"."transactions" FROM "anon";
