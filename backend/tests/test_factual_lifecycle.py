import unittest

from backend.factual_lifecycle import (
    EXECUTED_ORDER_DOCUMENT_TYPES,
    OPEN_EXECUTION_DOCUMENT_TYPES,
    PRE_EXECUTION_DOCUMENT_TYPES,
)


class FactualLifecycleTests(unittest.TestCase):
    def test_derives_expected_sales_lifecycle_groups(self):
        self.assertEqual(OPEN_EXECUTION_DOCUMENT_TYPES, ["ΠΔΣ"])
        self.assertIn("ΠΑΡ", PRE_EXECUTION_DOCUMENT_TYPES)
        self.assertIn("ΕΑΠ", PRE_EXECUTION_DOCUMENT_TYPES)
        self.assertIn("ΤΔΑ", EXECUTED_ORDER_DOCUMENT_TYPES)
        self.assertIn("ΤΙΠ", EXECUTED_ORDER_DOCUMENT_TYPES)
        self.assertIn("ΑΠΛ", EXECUTED_ORDER_DOCUMENT_TYPES)


if __name__ == "__main__":
    unittest.main()
