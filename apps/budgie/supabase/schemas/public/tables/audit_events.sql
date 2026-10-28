CREATE TABLE "public"."audit_events" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "budget_id"     uuid                     NOT NULL,
  "actor_user_id" uuid,
  "recorded_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "operation"     text                     NOT NULL,
  "entity_type"   text                     NOT NULL,
  "entity_id"     uuid                     NOT NULL,
  "before_data"   jsonb,
  "after_data"    jsonb,
  "request_id"    uuid                     NOT NULL,
  CONSTRAINT "audit_events_pkey" PRIMARY KEY (id),
  CONSTRAINT "audit_events_budget_id_fkey" FOREIGN KEY (budget_id) REFERENCES public.budgets(id)
);

ALTER TABLE "public"."audit_events"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX audit_events_entity ON public.audit_events USING btree (budget_id, entity_type, entity_id, recorded_at);

CREATE POLICY "owner_read" ON "public"."audit_events"
  FOR SELECT
  TO "authenticated"
  USING (budgie_private.is_owner(budget_id));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."audit_events" TO "service_role";

REVOKE ALL ON TABLE "public"."audit_events" FROM "authenticated";

GRANT SELECT ON TABLE "public"."audit_events" TO "authenticated";

REVOKE ALL ON TABLE "public"."audit_events" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."audit_events" TO "postgres";

REVOKE ALL ON TABLE "public"."audit_events" FROM "anon";
