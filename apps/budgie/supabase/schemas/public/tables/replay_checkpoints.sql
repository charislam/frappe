-- Month-end calculation state, maintained atomically with the derived balances.
CREATE TABLE public.replay_checkpoints (
  budget_id uuid NOT NULL REFERENCES public.budgets,
  month date NOT NULL CHECK (extract(day from month) = 1),
  account_balances jsonb NOT NULL CHECK (jsonb_typeof(account_balances) = 'array'),
  deficit_lots jsonb NOT NULL CHECK (jsonb_typeof(deficit_lots) = 'array'),
  last_ordinal bigint NOT NULL CHECK (last_ordinal >= 0),
  PRIMARY KEY (budget_id, month)
);
ALTER TABLE public.replay_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_read ON public.replay_checkpoints FOR SELECT TO authenticated
  USING (budgie_private.is_owner(budget_id));
REVOKE ALL ON TABLE public.replay_checkpoints FROM anon, authenticated;
GRANT SELECT ON TABLE public.replay_checkpoints TO authenticated;
GRANT ALL ON TABLE public.replay_checkpoints TO service_role;
