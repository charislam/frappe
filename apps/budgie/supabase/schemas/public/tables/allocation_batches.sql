CREATE TABLE "public"."allocation_batches" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "budget_id"  uuid                     NOT NULL,
  "month"      date                     NOT NULL,
  "sequence"   bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "memo"       text,
  "version"    bigint                   NOT NULL DEFAULT 1,
  "voided_at"  timestamp with time zone,
  "created_by" uuid                     NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "allocation_batches_budget_id_id_key" UNIQUE (budget_id, id),
  CONSTRAINT "allocation_batches_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT "allocation_batches_month_check" CHECK ((EXTRACT(day FROM month) = (1)::numeric)),
  CONSTRAINT "allocation_batches_pkey" PRIMARY KEY (id),
  CONSTRAINT "allocation_batches_sequence_key" UNIQUE (SEQUENCE),
  CONSTRAINT "allocation_batches_version_check" CHECK ((version > 0)),
  CONSTRAINT "allocation_batches_budget_id_fkey" FOREIGN KEY (budget_id) REFERENCES public.budgets(id)
);

ALTER TABLE "public"."allocation_batches"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX allocation_batches_month ON public.allocation_batches USING btree (budget_id, month, SEQUENCE);

CREATE TRIGGER protect_identity
  BEFORE UPDATE ON public.allocation_batches
  FOR EACH ROW
  EXECUTE FUNCTION budgie_private.protect_identity();

CREATE CONSTRAINT TRIGGER validate_aggregate
  AFTER INSERT OR DELETE OR UPDATE ON public.allocation_batches DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION budgie_private.check_aggregate();

CREATE POLICY "owner_read" ON "public"."allocation_batches"
  FOR SELECT
  TO "authenticated"
  USING (budgie_private.is_owner(budget_id));

REVOKE ALL ON SEQUENCE "public"."allocation_batches_sequence_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."allocation_batches_sequence_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."allocation_batches_sequence_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."allocation_batches_sequence_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."allocation_batches_sequence_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."allocation_batches_sequence_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."allocation_batches_sequence_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."allocation_batches_sequence_seq" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."allocation_batches" TO "service_role";

REVOKE ALL ON TABLE "public"."allocation_batches" FROM "authenticated";

GRANT SELECT ON TABLE "public"."allocation_batches" TO "authenticated";

REVOKE ALL ON TABLE "public"."allocation_batches" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."allocation_batches" TO "postgres";

REVOKE ALL ON TABLE "public"."allocation_batches" FROM "anon";
