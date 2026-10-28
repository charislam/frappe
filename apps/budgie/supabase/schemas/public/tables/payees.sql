CREATE TABLE "public"."payees" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "budget_id"   uuid                     NOT NULL,
  "name"        text                     NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "archived_at" timestamp with time zone,
  CONSTRAINT "payees_budget_id_fkey" FOREIGN KEY (budget_id) REFERENCES public.budgets(id),
  CONSTRAINT "payees_budget_id_id_key" UNIQUE (budget_id, id),
  CONSTRAINT "payees_name_check" CHECK ((btrim(name) <> ''::text)),
  CONSTRAINT "payees_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."payees"
  ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX payees_normalized_name ON public.payees USING btree (budget_id, lower(btrim(name)));

CREATE POLICY "owner_read" ON "public"."payees"
  FOR SELECT
  TO "authenticated"
  USING (budgie_private.is_owner(budget_id));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."payees" TO "service_role";

REVOKE ALL ON TABLE "public"."payees" FROM "authenticated";

GRANT SELECT ON TABLE "public"."payees" TO "authenticated";

REVOKE ALL ON TABLE "public"."payees" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."payees" TO "postgres";

REVOKE ALL ON TABLE "public"."payees" FROM "anon";
