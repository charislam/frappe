CREATE TABLE "public"."budget_owners" (
  "budget_id"  uuid                     NOT NULL,
  "user_id"    uuid                     NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "budget_owners_pkey" PRIMARY KEY (budget_id, user_id),
  CONSTRAINT "budget_owners_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT "budget_owners_budget_id_fkey" FOREIGN KEY (budget_id) REFERENCES public.budgets(id) ON DELETE RESTRICT
);

ALTER TABLE "public"."budget_owners"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX budget_owners_user ON public.budget_owners USING btree (user_id, budget_id);

CREATE CONSTRAINT TRIGGER validate_aggregate
  AFTER INSERT OR DELETE OR UPDATE ON public.budget_owners DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION budgie_private.check_aggregate();

CREATE POLICY "owner_read" ON "public"."budget_owners"
  FOR SELECT
  TO "authenticated"
  USING (budgie_private.is_owner(budget_id));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."budget_owners" TO "service_role";

REVOKE ALL ON TABLE "public"."budget_owners" FROM "authenticated";

GRANT SELECT ON TABLE "public"."budget_owners" TO "authenticated";

REVOKE ALL ON TABLE "public"."budget_owners" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."budget_owners" TO "postgres";

REVOKE ALL ON TABLE "public"."budget_owners" FROM "anon";
