import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from import_entersoft import import_sales_lines, parse_date, parse_decimal, resolve_import_mode

TEST_TMP_DIR = Path(__file__).resolve().parents[2] / ".tmp"


def sample_sales_row():
    return {
        "Κωδικός": "C001",
        "Παραστατικό": "INV-1",
        "Είδος": "P001",
        "Ημ/νία ": "08/03/2026",
        "Τύπος Παραστατικών": "TI",
        "Περιγραφή": "Product 1",
        "ΜΜ": "PCS",
        "Ποσότητα": "10",
        "Ποσότητα σε βασική ΜΜ": "10",
        "Τιμή": "12,50",
        "Καθαρή  αξία ": "125,00",
        "% έκπτ.1": "0,00",
        "% έκπτ.2": "0,00",
        "Επωνυμία/Ονοματεπώνυμο": "Alpha Store",
        "Κωδικός1": "D1",
        "Περιγραφή1": "Main Store",
        "Κωδ. ΑΧ ": "A1",
        "Περ. ΑΧ": "Account",
        "Κωδ.υποκ.": "B1",
        "Περ.υποκ.": "Branch",
        "Σχόλιο 1": "Note",
    }


def invalid_sales_row():
    return {
        "Κωδικός": "",
        "Παραστατικό": "INV-1",
        "Είδος": "P001",
        "Ημ/νία ": "",
    }


def create_temp_sales_file():
    TEST_TMP_DIR.mkdir(exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix="sales-", suffix=".csv", dir=TEST_TMP_DIR)
    os.close(fd)
    sales_file = Path(temp_path)
    sales_file.write_text("unused", encoding="utf-8")
    return sales_file


class FakeCursor:
    def __init__(self):
        self.lastrowid = 0
        self.rowcount = 0
        self.imported_rows = set()
        self.import_run_insert_params = None
        self.import_run_update_params = None

    def execute(self, sql, params=None):
        normalized = " ".join(sql.split())
        if normalized.startswith("INSERT INTO import_runs"):
            self.import_run_insert_params = params
            self.lastrowid += 1
            self.rowcount = 1
            return
        if normalized.startswith("UPDATE import_runs"):
            self.import_run_update_params = params
            self.rowcount = 1
            return
        if normalized == "DELETE FROM imported_sales_lines":
            self.imported_rows.clear()
            self.rowcount = 0
            return
        if "INSERT IGNORE INTO imported_sales_lines" in normalized:
            logical_key = tuple(params[25:])
            if logical_key in self.imported_rows:
                self.rowcount = 0
            else:
                self.imported_rows.add(logical_key)
                self.rowcount = 1
            return
        self.rowcount = 0


class ImportEntersoftHelpersTest(unittest.TestCase):
    def test_parse_decimal_handles_greek_style_numbers(self):
        self.assertEqual(parse_decimal("1.234,50"), 1234.5)
        self.assertEqual(parse_decimal(""), 0.0)

    def test_parse_date_supports_two_digit_and_four_digit_years(self):
        self.assertEqual(parse_date("08/03/2026"), "2026-03-08")
        self.assertEqual(parse_date("08/03/26"), "2026-03-08")

    def test_resolve_import_mode_defaults_to_incremental(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ENTERSOFT_IMPORT_MODE", None)
            self.assertEqual(resolve_import_mode(), "incremental")

    def test_resolve_import_mode_rejects_unknown_values(self):
        with patch.dict(os.environ, {"ENTERSOFT_IMPORT_MODE": "bad-mode"}, clear=False):
            with self.assertRaises(RuntimeError):
                resolve_import_mode()

    def test_import_sales_lines_skips_duplicate_logical_rows(self):
        cursor = FakeCursor()
        sales_file = create_temp_sales_file()
        try:
            with patch("import_entersoft.csv.DictReader", return_value=[sample_sales_row(), sample_sales_row()]), \
                    patch("import_entersoft.rebuild_customers_from_sales") as rebuild_customers, \
                    patch("import_entersoft.rebuild_sales_aggregates") as rebuild_aggregates:
                stats = import_sales_lines(cursor, [sales_file], "incremental")
        finally:
            sales_file.unlink(missing_ok=True)

        self.assertEqual(stats.rows_in, 2)
        self.assertEqual(stats.rows_upserted, 1)
        self.assertEqual(stats.rows_skipped_duplicate, 1)
        self.assertEqual(stats.rows_rejected, 0)
        self.assertEqual(len(cursor.imported_rows), 1)
        self.assertIsNotNone(cursor.import_run_insert_params)
        self.assertIsNotNone(cursor.import_run_update_params)
        rebuild_customers.assert_called_once()
        rebuild_aggregates.assert_called_once()

    def test_import_sales_lines_full_refresh_clears_previous_imported_rows(self):
        cursor = FakeCursor()
        cursor.imported_rows.add(("stale",))
        sales_file = create_temp_sales_file()
        try:
            with patch("import_entersoft.csv.DictReader", return_value=[sample_sales_row()]), \
                    patch("import_entersoft.rebuild_customers_from_sales", MagicMock()), \
                    patch("import_entersoft.rebuild_sales_aggregates", MagicMock()):
                stats = import_sales_lines(cursor, [sales_file], "full_refresh")
        finally:
            sales_file.unlink(missing_ok=True)

        self.assertEqual(stats.rows_in, 1)
        self.assertEqual(stats.rows_upserted, 1)
        self.assertEqual(len(cursor.imported_rows), 1)

    def test_import_sales_lines_records_rejected_rows_and_ledger_metadata(self):
        cursor = FakeCursor()
        sales_file = create_temp_sales_file()
        try:
            with patch("import_entersoft.csv.DictReader", return_value=[sample_sales_row(), invalid_sales_row()]), \
                    patch("import_entersoft.rebuild_customers_from_sales", MagicMock()), \
                    patch("import_entersoft.rebuild_sales_aggregates", MagicMock()):
                stats = import_sales_lines(cursor, [sales_file], "incremental")
        finally:
            sales_file.unlink(missing_ok=True)

        self.assertEqual(stats.source_row_count, 2)
        self.assertEqual(stats.rows_in, 2)
        self.assertEqual(stats.rows_upserted, 1)
        self.assertEqual(stats.rows_rejected, 1)
        self.assertEqual(stats.rows_skipped_duplicate, 0)
        self.assertIsNotNone(stats.rebuild_started_at)
        self.assertIsNotNone(stats.rebuild_finished_at)
        self.assertIn('"raw_fact_table":"imported_sales_lines"', stats.metadata_json)
        self.assertEqual(stats.trigger_source, "manual_or_cli")

        self.assertIn("incremental", cursor.import_run_insert_params)
        self.assertIn("import-ledger-v2", cursor.import_run_insert_params)
        self.assertIn("manual_or_cli", cursor.import_run_insert_params)
        self.assertIn(2, cursor.import_run_update_params)
        self.assertIn(1, cursor.import_run_update_params)


if __name__ == "__main__":
    unittest.main()
