CREATE TABLE "public"."accounts" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "budget_id"   uuid                     NOT NULL,
  "name"        text                     NOT NULL,
  "kind"        text                     NOT NULL,
  "sort_order"  integer                  NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "archived_at" timestamp with time zone,
  CONSTRAINT "accounts_budget_id_id_key" UNIQUE (budget_id, id),
  CONSTRAINT "accounts_budget_id_sort_order_key" UNIQUE (budget_id, sort_order) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "accounts_kind_check" CHECK ((kind = ANY (ARRAY['cash'::text, 'credit'::text, 'investment'::text]))),
  CONSTRAINT "accounts_name_check" CHECK ((btrim(name) <> ''::text)),
  CONSTRAINT "accounts_pkey" PRIMARY KEY (id),
  CONSTRAINT "accounts_sort_order_check" CHECK ((sort_order >= 0)),
  CONSTRAINT "accounts_budget_id_fkey" FOREIGN KEY (budget_id) REFERENCES public.budgets(id)
);

ALTER TABLE "public"."accounts"
  ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER protect_identity
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION budgie_private.protect_identity();

CREATE CONSTRAINT TRIGGER validate_aggregate
  AFTER INSERT OR DELETE OR UPDATE ON public.accounts DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION budgie_private.check_aggregate();

CREATE POLICY "owner_read" ON "public"."accounts"
  FOR SELECT
  TO "authenticated"
  USING (budgie_private.is_owner(budget_id));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."accounts" TO "service_role";

REVOKE ALL ON TABLE "public"."accounts" FROM "authenticated";

GRANT SELECT ON TABLE "public"."accounts" TO "authenticated";

REVOKE ALL ON TABLE "public"."accounts" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."accounts" TO "postgres";

REVOKE ALL ON TABLE "public"."accounts" FROM "anon";
