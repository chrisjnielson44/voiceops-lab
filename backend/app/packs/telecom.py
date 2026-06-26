"""
Telecom pack — consumer wireless/ISP support & billing calls. Second
non-healthcare domain on GenericPack, showing the catalog spanning multiple
domains. Facts-backed, no PHI (account data is not flagged sensitive here).
"""
from __future__ import annotations

from app.packs.generic import GenericPack, make_scenario
from app.schemas.simulation import Scenario

_OUTAGE = make_scenario(
    {
        "id": "telco-outage-credit",
        "title": "Outage service credit",
        "payer": "Northwind Mobile",
        "payer_id": "NW-CARE",
        "category": "billing",
        "difficulty": "moderate",
        "outcome": "completed",
        "objective": "Get a prorated service credit for a multi-day home-internet outage and capture the credit amount and when it posts.",
        "patient": {"name": "Elena Park", "member_id": "ACCT-330-77412", "dob": ""},
        "provider": {"name": "Elena Park (account holder)", "npi": "", "tax_id": ""},
        "required_fields": ["account_id", "outage_dates", "credit_amount", "credit_posts_on"],
        "baseline_completion_prob": 0.78,
        "baseline_escalation_risk": 0.1,
        "facts": (
            "ACCOUNT: Elena Park, fiber 600 plan at $70/mo, account ACCT-330-77412, autopay on.\n"
            "OUTAGE: confirmed regional fiber outage 2026-06-19 through 2026-06-22 (4 days) affecting this address.\n"
            "CREDIT: policy is a prorated credit for the outage days — $70/30*4 = $9.33; posts to the next bill on 2026-07-05.\n"
            "AUTH: verify the account holder with the account ID and the last 4 of the phone number on file (4471)."
        ),
    }
)

_PLAN = make_scenario(
    {
        "id": "telco-plan-change",
        "title": "Upgrade wireless plan",
        "payer": "Northwind Mobile",
        "payer_id": "NW-CARE",
        "category": "plan-change",
        "difficulty": "routine",
        "outcome": "completed",
        "objective": "Move two lines to the unlimited-premium plan, confirm the new monthly total and the effective date, and check for any early-termination or proration.",
        "patient": {"name": "Tomas Vela", "member_id": "ACCT-330-55190", "dob": ""},
        "provider": {"name": "Tomas Vela (account holder)", "npi": "", "tax_id": ""},
        "required_fields": ["account_id", "new_plan", "new_monthly_total", "effective_date", "proration"],
        "baseline_completion_prob": 0.86,
        "baseline_escalation_risk": 0.04,
        "facts": (
            "ACCOUNT: Tomas Vela, 2 lines currently on Unlimited-Basic at $55/line ($110/mo).\n"
            "UPGRADE: Unlimited-Premium is $70/line; 2 lines = $140/mo. No contract/ETF (plans are month-to-month).\n"
            "EFFECTIVE: change takes effect at the start of the next bill cycle on 2026-07-01; a small proration applies to the current cycle.\n"
            "AUTH: verify with the account ID and account PIN (820194)."
        ),
    }
)

_BILLING = make_scenario(
    {
        "id": "telco-overage-dispute",
        "title": "Dispute a data overage charge",
        "payer": "Northwind Mobile",
        "payer_id": "NW-CARE",
        "category": "billing-dispute",
        "difficulty": "complex",
        "outcome": "escalated",
        "objective": "Dispute a $90 data-overage charge the customer believes is wrong, get it reversed if the plan should have been unlimited, or route to a billing specialist.",
        "patient": {"name": "Grace Okafor", "member_id": "ACCT-330-88003", "dob": ""},
        "provider": {"name": "Grace Okafor (account holder)", "npi": "", "tax_id": ""},
        "required_fields": ["account_id", "overage_amount", "plan_on_file", "dispute_outcome", "specialist_required"],
        "baseline_completion_prob": 0.5,
        "baseline_escalation_risk": 0.4,
        "facts": (
            "ACCOUNT: Grace Okafor, account ACCT-330-88003. Bill shows a $90 data-overage charge for June.\n"
            "DISCREPANCY: the account notes a plan change to Unlimited on 2026-05-28, but the overage was billed on the OLD metered "
            "plan — the change may not have applied to the billing system in time.\n"
            "POLICY: the front-line rep can see the discrepancy but a billing specialist must approve a charge reversal over $50.\n"
            "AUTH: verify with the account ID and account PIN (553071)."
        ),
    }
)

_SCENARIOS: list[Scenario] = [_OUTAGE, _PLAN, _BILLING]


class TelecomPack(GenericPack):
    id = "telecom"
    label = "Telecom — support & billing"
    description = "Wireless/ISP support calls: outage credits, plan changes, and billing disputes."
    sensitive = False
    subject_noun = "account"

    def scenarios(self) -> list[Scenario]:
        return _SCENARIOS
