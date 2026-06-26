"""
Banking pack — consumer card & account servicing calls. A non-healthcare domain
built on GenericPack: facts-backed (no Neon tables), generic tools, tokenized
audit (account numbers are sensitive). Demonstrates the pack seam carrying a
brand-new domain with zero orchestrator changes.
"""
from __future__ import annotations

from app.packs.generic import GenericPack, make_scenario
from app.schemas.simulation import Scenario

_DISPUTE = make_scenario(
    {
        "id": "bank-dispute",
        "title": "Disputed card charge",
        "payer": "Summit Bank",
        "payer_id": "SUM-CARD",
        "category": "card-dispute",
        "difficulty": "moderate",
        "outcome": "completed",
        "objective": "Dispute a $248.19 charge the cardholder doesn't recognize, get a provisional credit, and capture the dispute case number and resolution timeline.",
        "patient": {"name": "Dana Whitlock", "member_id": "4012-88xx-xx41-2207", "dob": ""},
        "provider": {"name": "Dana Whitlock (account holder)", "npi": "", "tax_id": ""},
        "required_fields": ["card_last4", "charge_amount", "merchant", "dispute_case_id", "provisional_credit", "resolution_window"],
        "baseline_completion_prob": 0.74,
        "baseline_escalation_risk": 0.14,
        "facts": (
            "ACCOUNT: cardholder Dana Whitlock, Visa Signature ending 2207, account in good standing.\n"
            "DISPUTED CHARGE: $248.19 on 2026-06-18, merchant 'NRG*FUEL STOP 7741', posted (not pending).\n"
            "DISPUTE: case number DSP-55102 opened; provisional credit of $248.19 issued within 1 business day; "
            "investigation window up to 10 business days; cardholder not liable while under review.\n"
            "AUTH: verify identity with the last 4 of the card and the cardholder's ZIP (98103) before discussing the account."
        ),
    }
)

_PAYMENT = make_scenario(
    {
        "id": "bank-payment-plan",
        "title": "Past-due loan — payment arrangement",
        "payer": "Summit Bank",
        "payer_id": "SUM-LOAN",
        "category": "payments",
        "difficulty": "complex",
        "outcome": "escalated",
        "objective": "Set up a hardship payment arrangement on a past-due auto loan and capture the terms, or route to a loss-mitigation specialist if one is required.",
        "patient": {"name": "Marcus Reyes", "member_id": "AUTO-7741-0099", "dob": ""},
        "provider": {"name": "Marcus Reyes (borrower)", "npi": "", "tax_id": ""},
        "required_fields": ["loan_id", "past_due_amount", "hardship_reason", "arrangement_terms", "specialist_required"],
        "baseline_completion_prob": 0.46,
        "baseline_escalation_risk": 0.44,
        "facts": (
            "LOAN: auto loan AUTO-7741-0099, balance $14,320, 2 payments past due totaling $812.40, 41 days delinquent.\n"
            "POLICY: a one-time 60-day deferral is available, but any restructure of the payment schedule for a hardship "
            "requires a loss-mitigation specialist — the front-line rep cannot finalize new terms on this call.\n"
            "AUTH: verify the borrower with loan ID and date of birth before discussing the balance."
        ),
    }
)

_TRAVEL = make_scenario(
    {
        "id": "bank-travel-decline",
        "title": "Card declined abroad",
        "payer": "Summit Bank",
        "payer_id": "SUM-CARD",
        "category": "card-servicing",
        "difficulty": "routine",
        "outcome": "completed",
        "objective": "Find out why the card is declining overseas, clear the fraud hold, and confirm the card will work for the rest of the trip.",
        "patient": {"name": "Priya Nair", "member_id": "4012-88xx-xx41-9930", "dob": ""},
        "provider": {"name": "Priya Nair (account holder)", "npi": "", "tax_id": ""},
        "required_fields": ["card_last4", "hold_reason", "hold_cleared", "travel_dates"],
        "baseline_completion_prob": 0.82,
        "baseline_escalation_risk": 0.06,
        "facts": (
            "ACCOUNT: cardholder Priya Nair, Visa ending 9930, no travel notice on file.\n"
            "HOLD: a fraud hold was placed 2026-06-25 after two declined attempts in Lisbon, Portugal flagged as out-of-pattern.\n"
            "RESOLUTION: once identity is verified, the rep can clear the hold and add a travel notice through 2026-07-09; "
            "card will then work normally abroad.\n"
            "AUTH: verify with last 4 of the card and the security word on file ('marigold')."
        ),
    }
)

_SCENARIOS: list[Scenario] = [_DISPUTE, _PAYMENT, _TRAVEL]


class BankingPack(GenericPack):
    id = "banking"
    label = "Banking — card & account servicing"
    description = "Consumer banking calls: card disputes, payment arrangements, and travel/fraud holds."
    sensitive = True
    subject_noun = "account"

    def scenarios(self) -> list[Scenario]:
        return _SCENARIOS
