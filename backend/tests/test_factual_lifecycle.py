import json
import unittest
from pathlib import Path

from backend.factual_lifecycle import (
    FACTUAL_LIFECYCLE_RULES,
    EXECUTED_ORDER_DOCUMENT_TYPES,
    OPEN_EXECUTION_DOCUMENT_TYPES,
    PRE_EXECUTION_DOCUMENT_TYPES,
)
from backend.generate_factual_lifecycle_rules import derive_factual_lifecycle_rules


class FactualLifecycleTests(unittest.TestCase):
    def test_derives_expected_sales_lifecycle_groups(self):
        self.assertEqual(OPEN_EXECUTION_DOCUMENT_TYPES, ["ΠΔΣ"])
        self.assertIn("ΠΑΡ", PRE_EXECUTION_DOCUMENT_TYPES)
        self.assertIn("ΕΑΠ", PRE_EXECUTION_DOCUMENT_TYPES)
        self.assertIn("ΤΔΑ", EXECUTED_ORDER_DOCUMENT_TYPES)
        self.assertIn("ΤΙΠ", EXECUTED_ORDER_DOCUMENT_TYPES)
        self.assertIn("ΑΠΛ", EXECUTED_ORDER_DOCUMENT_TYPES)

    def test_shared_lifecycle_artifact_matches_generator_output(self):
        artifact_path = Path(__file__).resolve().parents[2] / "factual_lifecycle_rules.json"
        artifact = json.loads(artifact_path.read_text(encoding="utf-8"))

        self.assertEqual(FACTUAL_LIFECYCLE_RULES, artifact)
        self.assertEqual(derive_factual_lifecycle_rules(), artifact)


if __name__ == "__main__":
    unittest.main()
