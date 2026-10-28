CREATE TABLE "public"."budgets" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"             text                     NOT NULL,
  "currency_code"    text                     NOT NULL,
  "minor_unit_scale" smallint                 NOT NULL,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "archived_at"      timestamp with time zone,
  CONSTRAINT "budgets_currency_code_check" CHECK ((currency_code ~ '^[A-Z]{3}$'::text)),
  CONSTRAINT "budgets_minor_unit_scale_check" CHECK (((minor_unit_scale >= 0) AND (minor_unit_scale <= 6))),
  CONSTRAINT "budgets_name_check" CHECK ((btrim(name) <> ''::text)),
  CONSTRAINT "budgets_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."budgets"
  ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER protect_identity
  BEFORE UPDATE ON public.budgets
  FOR EACH ROW
  EXECUTE FUNCTION budgie_private.protect_identity();

CREATE CONSTRAINT TRIGGER validate_aggregate
  AFTER INSERT OR DELETE OR UPDATE ON public.budgets DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION budgie_private.check_aggregate();

CREATE POLICY "owner_read" ON "public"."budgets"
  FOR SELECT
  TO "authenticated"
  USING (budgie_private.is_owner(id));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."budgets" TO "service_role";

REVOKE ALL ON TABLE "public"."budgets" FROM "authenticated";

GRANT SELECT ON TABLE "public"."budgets" TO "authenticated";

REVOKE ALL ON TABLE "public"."budgets" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."budgets" TO "postgres";

REVOKE ALL ON TABLE "public"."budgets" FROM "anon";
