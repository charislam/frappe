CREATE TABLE "public"."write_requests" (
  "budget_id"     uuid                     NOT NULL,
  "request_id"    uuid                     NOT NULL,
  "actor_user_id" uuid                     NOT NULL,
  "payload_hash"  text                     NOT NULL,
  "result"        jsonb                    NOT NULL,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "write_requests_budget_id_fkey" FOREIGN KEY (budget_id) REFERENCES public.budgets(id),
  CONSTRAINT "write_requests_pkey" PRIMARY KEY (budget_id, request_id)
);

ALTER TABLE "public"."write_requests"
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_read" ON "public"."write_requests"
  FOR SELECT
  TO "authenticated"
  USING (budgie_private.is_owner(budget_id));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."write_requests" TO "service_role";

REVOKE ALL ON TABLE "public"."write_requests" FROM "authenticated";

GRANT SELECT ON TABLE "public"."write_requests" TO "authenticated";

REVOKE ALL ON TABLE "public"."write_requests" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."write_requests" TO "postgres";

REVOKE ALL ON TABLE "public"."write_requests" FROM "anon";
