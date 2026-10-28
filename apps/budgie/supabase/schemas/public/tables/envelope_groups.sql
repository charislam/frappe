CREATE TABLE "public"."envelope_groups" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "budget_id"   uuid                     NOT NULL,
  "name"        text                     NOT NULL,
  "sort_order"  integer                  NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "envelope_groups_budget_id_fkey" FOREIGN KEY (budget_id) REFERENCES public.budgets(id),
  CONSTRAINT "envelope_groups_budget_id_id_key" UNIQUE (budget_id, id),
  CONSTRAINT "envelope_groups_budget_id_sort_order_key" UNIQUE (budget_id, sort_order) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "envelope_groups_name_check" CHECK ((btrim(name) <> ''::text)),
  CONSTRAINT "envelope_groups_pkey" PRIMARY KEY (id),
  CONSTRAINT "envelope_groups_sort_order_check" CHECK ((sort_order >= 0))
);

ALTER TABLE "public"."envelope_groups"
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_read" ON "public"."envelope_groups"
  FOR SELECT
  TO "authenticated"
  USING (budgie_private.is_owner(budget_id));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."envelope_groups" TO "service_role";

REVOKE ALL ON TABLE "public"."envelope_groups" FROM "authenticated";

GRANT SELECT ON TABLE "public"."envelope_groups" TO "authenticated";

REVOKE ALL ON TABLE "public"."envelope_groups" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."envelope_groups" TO "postgres";

REVOKE ALL ON TABLE "public"."envelope_groups" FROM "anon";
