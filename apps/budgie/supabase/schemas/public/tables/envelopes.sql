CREATE TABLE "public"."envelopes" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "budget_id"         uuid                     NOT NULL,
  "group_id"          uuid,
  "name"              text                     NOT NULL,
  "kind"              text                     NOT NULL,
  "credit_account_id" uuid,
  "sort_order"        integer                  NOT NULL,
  "archived_at"       timestamp with time zone,
  CONSTRAINT "envelopes_budget_id_credit_account_id_fkey" FOREIGN KEY (budget_id, credit_account_id) REFERENCES public.accounts(budget_id, id),
  CONSTRAINT "envelopes_budget_id_fkey" FOREIGN KEY (budget_id) REFERENCES public.budgets(id),
  CONSTRAINT "envelopes_budget_id_group_id_fkey" FOREIGN KEY (budget_id, group_id) REFERENCES public.envelope_groups(budget_id, id),
  CONSTRAINT "envelopes_budget_id_group_id_sort_order_key" UNIQUE NULLS NOT DISTINCT (budget_id, group_id, sort_order) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "envelopes_budget_id_id_key" UNIQUE (budget_id, id),
  CONSTRAINT "envelopes_check" CHECK (((kind = 'credit_payment'::text) = (credit_account_id IS NOT NULL))),
  CONSTRAINT "envelopes_kind_check" CHECK ((kind = ANY (ARRAY['regular'::text, 'ready_to_assign'::text, 'credit_payment'::text]))),
  CONSTRAINT "envelopes_name_check" CHECK ((btrim(name) <> ''::text)),
  CONSTRAINT "envelopes_pkey" PRIMARY KEY (id),
  CONSTRAINT "envelopes_sort_order_check" CHECK ((sort_order >= 0))
);

ALTER TABLE "public"."envelopes"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX envelopes_group ON public.envelopes USING btree (budget_id, group_id);

CREATE UNIQUE INDEX envelopes_payment ON public.envelopes USING btree (budget_id, credit_account_id)
  WHERE (kind = 'credit_payment'::text);

CREATE UNIQUE INDEX envelopes_ready ON public.envelopes USING btree (budget_id)
  WHERE (kind = 'ready_to_assign'::text);

CREATE TRIGGER protect_identity
  BEFORE UPDATE ON public.envelopes
  FOR EACH ROW
  EXECUTE FUNCTION budgie_private.protect_identity();

CREATE CONSTRAINT TRIGGER validate_aggregate
  AFTER INSERT OR DELETE OR UPDATE ON public.envelopes DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION budgie_private.check_aggregate();

CREATE POLICY "owner_read" ON "public"."envelopes"
  FOR SELECT
  TO "authenticated"
  USING (budgie_private.is_owner(budget_id));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."envelopes" TO "service_role";

REVOKE ALL ON TABLE "public"."envelopes" FROM "authenticated";

GRANT SELECT ON TABLE "public"."envelopes" TO "authenticated";

REVOKE ALL ON TABLE "public"."envelopes" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."envelopes" TO "postgres";

REVOKE ALL ON TABLE "public"."envelopes" FROM "anon";
