"""Pydantic models that define the JSON wire contracts (camelCase, matching the
existing TypeScript API so the Next.js frontend needs no changes)."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base model: accept snake_case in Python, emit camelCase JSON by default."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        protected_namespaces=(),
    )

    def to_wire(self) -> dict:
        """Serialize to the camelCase dict shape sent over the API / SSE."""
        return self.model_dump(by_alias=True, exclude_none=True)
