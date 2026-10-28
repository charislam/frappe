CREATE TABLE "public"."envelope_month_balances" (
  "budget_id"       uuid   NOT NULL,
  "envelope_id"     uuid   NOT NULL,
  "month"           date   NOT NULL,
  "opening_minor"   bigint NOT NULL,
  "allocated_minor" bigint NOT NULL,
  "activity_minor"  bigint NOT NULL,
  "closing_minor"   bigint NOT NULL,
  CONSTRAINT "envelope_month_balances_check" CHECK ((closing_minor = ((opening_minor + allocated_minor) + activity_minor))),
  CONSTRAINT "envelope_month_balances_month_check" CHECK ((EXTRACT(day FROM month) = (1)::numeric)),
  CONSTRAINT "envelope_month_balances_pkey" PRIMARY KEY (budget_id, envelope_id, month),
  CONSTRAINT "envelope_month_balances_budget_id_envelope_id_fkey" FOREIGN KEY (budget_id, envelope_id) REFERENCES public.envelopes(budget_id, id)
);

ALTER TABLE "public"."envelope_month_balances"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX envelope_month_balances_month ON public.envelope_month_balances USING btree (budget_id, month, envelope_id);

CREATE POLICY "owner_read" ON "public"."envelope_month_balances"
  FOR SELECT
  TO "authenticated"
  USING (budgie_private.is_owner(budget_id));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."envelope_month_balances" TO "service_role";

REVOKE ALL ON TABLE "public"."envelope_month_balances" FROM "authenticated";

GRANT SELECT ON TABLE "public"."envelope_month_balances" TO "authenticated";

REVOKE ALL ON TABLE "public"."envelope_month_balances" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."envelope_month_balances" TO "postgres";

REVOKE ALL ON TABLE "public"."envelope_month_balances" FROM "anon";
