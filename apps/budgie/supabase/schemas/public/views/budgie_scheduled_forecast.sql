CREATE VIEW "public"."budgie_scheduled_forecast" WITH (security_invoker=true) AS  SELECT id,
    budget_id,
    kind,
    effective_date,
    payee_id,
    memo,
    (sequence)::text AS sequence,
    (version)::text AS version,
    ( SELECT jsonb_agg(jsonb_build_object('account_id', e.account_id, 'amount_minor', (e.amount_minor)::text, 'position', e."position") ORDER BY e."position") AS jsonb_agg
           FROM public.account_entries e
          WHERE (e.transaction_id = t.id)) AS entries,
    ( SELECT COALESCE(jsonb_agg(jsonb_build_object('envelope_id', s.envelope_id, 'amount_minor', (s.amount_minor)::text, 'position', s."position") ORDER BY s."position"), '[]'::jsonb) AS "coalesce"
           FROM public.transaction_splits s
          WHERE (s.transaction_id = t.id)) AS splits
   FROM public.transactions t
  WHERE (status = 'scheduled'::text);

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."budgie_scheduled_forecast" TO "service_role";

REVOKE ALL ON TABLE "public"."budgie_scheduled_forecast" FROM "authenticated";

GRANT SELECT ON TABLE "public"."budgie_scheduled_forecast" TO "authenticated";

REVOKE ALL ON TABLE "public"."budgie_scheduled_forecast" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."budgie_scheduled_forecast" TO "postgres";

REVOKE ALL ON TABLE "public"."budgie_scheduled_forecast" FROM "anon";
