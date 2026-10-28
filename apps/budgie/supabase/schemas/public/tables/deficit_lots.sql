-- Derived outstanding spending deficits, rebuilt atomically with the summaries.
CREATE TABLE public.deficit_lots (
  budget_id uuid NOT NULL,
  ordinal bigint NOT NULL CHECK (ordinal > 0),
  transaction_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  envelope_id uuid NOT NULL,
  card_id uuid,
  remaining_minor bigint NOT NULL CHECK (remaining_minor >= 0),
  eligible_minor bigint NOT NULL DEFAULT 0 CHECK (eligible_minor >= 0),
  direct_covered_minor bigint NOT NULL DEFAULT 0 CHECK (direct_covered_minor >= 0),
  PRIMARY KEY (budget_id, ordinal),
  FOREIGN KEY (budget_id, transaction_id) REFERENCES public.transactions (budget_id, id),
  FOREIGN KEY (budget_id, envelope_id) REFERENCES public.envelopes (budget_id, id),
  FOREIGN KEY (budget_id, card_id) REFERENCES public.accounts (budget_id, id),
  CHECK (eligible_minor + direct_covered_minor <= remaining_minor),
  CHECK (card_id IS NOT NULL OR (eligible_minor = 0 AND direct_covered_minor = 0))
);

CREATE INDEX deficit_lots_envelope ON public.deficit_lots (budget_id, envelope_id, ordinal);
CREATE INDEX deficit_lots_card ON public.deficit_lots (budget_id, card_id, ordinal) WHERE card_id IS NOT NULL;
CREATE INDEX deficit_lots_transaction ON public.deficit_lots (budget_id, transaction_id);

ALTER TABLE public.deficit_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_read ON public.deficit_lots FOR SELECT TO authenticated
  USING (budgie_private.is_owner(budget_id));
REVOKE ALL ON TABLE public.deficit_lots FROM anon, authenticated;
GRANT SELECT ON TABLE public.deficit_lots TO authenticated;
GRANT ALL ON TABLE public.deficit_lots TO service_role;
