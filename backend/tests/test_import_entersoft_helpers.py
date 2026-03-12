import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from import_entersoft import import_customer_ledgers, import_sales_lines, parse_date, parse_decimal, resolve_import_mode

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


def sample_ledger_row():
    return {
        "Κωδικός": "C001",
        "Επωνυμία": "Alpha Store",
        "Εκ μεταφοράς": "10,00",
        "Χρέωση ": "50,00",
        "Πίστωση ": "25,00",
        "Λογιστικό υπόλοιπο": "35,00",
        "Εκκρεμή αξιόγραφα": "5,00",
        "Εμπορικό υπόλοιπο": "40,00",
        "Ηλεκτρονική διεύθυνση": "alpha@example.com",
        "Ανενεργός": "0",
        "Πωλητής": "90",
    }


def invalid_ledger_row():
    return {
        "Κωδικός": "",
        "Επωνυμία": "",
    }


def create_temp_ledger_file():
    TEST_TMP_DIR.mkdir(exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix="ledger-", suffix=".csv", dir=TEST_TMP_DIR)
    os.close(fd)
    ledger_file = Path(temp_path)
    ledger_file.write_text("unused", encoding="utf-8")
    return ledger_file


class FakeCursor:
    def __init__(self):
        self.lastrowid = 0
        self.rowcount = 0
        self.imported_rows = []
        self.imported_ledgers = {}
        self.import_run_insert_params = None
        self.import_run_update_params = None
        self._fetchall_result = []

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
        if normalized == "DELETE FROM imported_customer_ledgers":
            self.imported_ledgers.clear()
            self.rowcount = 0
            return
        if "SELECT id FROM imported_sales_lines" in normalized:
            business_key = tuple(params)
            matches = [row for row in self.imported_rows if row["business_key"] == business_key]
            self._fetchall_result = [(row["id"],) for row in matches]
            self.rowcount = len(self._fetchall_result)
            return
        if normalized.startswith("UPDATE imported_sales_lines SET"):
            row_id = params[-1]
            row = next((item for item in self.imported_rows if item["id"] == row_id), None)
            if row is None:
                self.rowcount = 0
                return
            mutable_values = tuple(params[:-1])
            if row["mutable_values"] == mutable_values:
                self.rowcount = 0
            else:
                row["mutable_values"] = mutable_values
                row["source_file"] = params[0]
                self.rowcount = 1
            return
        if normalized.startswith("INSERT INTO imported_sales_lines"):
            self.lastrowid += 1
            business_key = (
                params[1],
                params[4],
                params[5],
                params[6],
                params[16],
                params[18],
                params[22],
                params[9],
                params[10],
                params[11],
            )
            mutable_values = (
                params[0],
                params[7],
                params[8],
                params[12],
                params[13],
                params[14],
                params[15],
                params[17],
                params[19],
                params[20],
                params[21],
                params[23],
                params[24],
            )
            self.imported_rows.append(
                {
                    "id": self.lastrowid,
                    "business_key": business_key,
                    "mutable_values": mutable_values,
                    "source_file": params[0],
                }
            )
            self.rowcount = 1
            return
        if normalized.startswith("INSERT INTO imported_customer_ledgers"):
            self.imported_ledgers[params[0]] = {
                "customer_code": params[0],
                "customer_name": params[1],
                "opening_balance": params[2],
                "debit": params[3],
                "credit": params[4],
                "ledger_balance": params[5],
                "pending_instruments": params[6],
                "commercial_balance": params[7],
                "email": params[8],
                "is_inactive": params[9],
                "salesperson_code": params[10],
                "source_file": params[11],
            }
            self.rowcount = 1
            return
        if normalized.startswith("INSERT INTO customers(code, name, email, source) SELECT customer_code, customer_name, email, 'entersoft_import' FROM imported_customer_ledgers"):
            self.rowcount = len(self.imported_ledgers)
            return
        self.rowcount = 0

    def fetchall(self):
        return list(self._fetchall_result)


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

    def test_import_sales_lines_replaces_single_business_key_match(self):
        cursor = FakeCursor()
        existing_row = sample_sales_row()
        updated_row = sample_sales_row()
        updated_row["% Ξ­ΞΊΟ€Ο„.1"] = "30,00"
        updated_row["Ξ£Ο‡ΟΞ»ΞΉΞΏ 1"] = "Promo"
        existing_file = create_temp_sales_file()
        updated_file = create_temp_sales_file()
        try:
            with patch("import_entersoft.csv.DictReader", return_value=[existing_row]), \
                    patch("import_entersoft.rebuild_customers_from_sales", MagicMock()), \
                    patch("import_entersoft.rebuild_sales_aggregates", MagicMock()):
                import_sales_lines(cursor, [existing_file], "incremental")
            with patch("import_entersoft.csv.DictReader", return_value=[updated_row]), \
                    patch("import_entersoft.rebuild_customers_from_sales", MagicMock()), \
                    patch("import_entersoft.rebuild_sales_aggregates", MagicMock()):
                stats = import_sales_lines(cursor, [updated_file], "incremental")
        finally:
            existing_file.unlink(missing_ok=True)
            updated_file.unlink(missing_ok=True)

        self.assertEqual(stats.rows_in, 1)
        self.assertEqual(stats.rows_upserted, 1)
        self.assertEqual(stats.rows_replaced, 1)
        self.assertEqual(stats.rows_skipped_duplicate, 0)
        self.assertEqual(stats.rows_skipped_ambiguous, 0)
        self.assertEqual(len(cursor.imported_rows), 1)
        self.assertEqual(cursor.imported_rows[0]["source_file"], updated_file.name)

    def test_import_sales_lines_rejects_ambiguous_business_key_match(self):
        cursor = FakeCursor()
        row = sample_sales_row()
        business_key = (
            "2026-03-08",
            "INV-1",
            "TI",
            "P001",
            "C001",
            "D1",
            "B1",
            10.0,
            10.0,
            12.5,
        )
        cursor.imported_rows = [
            {"id": 1, "business_key": business_key, "mutable_values": tuple(), "source_file": "a.csv"},
            {"id": 2, "business_key": business_key, "mutable_values": tuple(), "source_file": "b.csv"},
        ]
        sales_file = create_temp_sales_file()
        try:
            with patch("import_entersoft.csv.DictReader", return_value=[row]), \
                    patch("import_entersoft.rebuild_customers_from_sales", MagicMock()), \
                    patch("import_entersoft.rebuild_sales_aggregates", MagicMock()):
                stats = import_sales_lines(cursor, [sales_file], "incremental")
        finally:
            sales_file.unlink(missing_ok=True)

        self.assertEqual(stats.rows_in, 1)
        self.assertEqual(stats.rows_upserted, 0)
        self.assertEqual(stats.rows_skipped_ambiguous, 1)
        self.assertEqual(stats.rows_rejected, 1)

    def test_import_sales_lines_full_refresh_clears_previous_imported_rows(self):
        cursor = FakeCursor()
        cursor.imported_rows.append({"id": 999, "business_key": ("stale",), "mutable_values": tuple(), "source_file": "stale.csv"})
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

    def test_import_customer_ledgers_replaces_snapshot_and_records_run(self):
        cursor = FakeCursor()
        cursor.imported_ledgers["OLD"] = {"customer_code": "OLD"}
        ledger_file = create_temp_ledger_file()
        try:
            with patch("import_entersoft.csv.DictReader", return_value=[sample_ledger_row(), invalid_ledger_row()]):
                stats = import_customer_ledgers(cursor, ledger_file)
        finally:
            ledger_file.unlink(missing_ok=True)

        self.assertEqual(stats.dataset, "customer_ledgers")
        self.assertEqual(stats.import_mode, "snapshot_replace")
        self.assertEqual(stats.source_row_count, 2)
        self.assertEqual(stats.rows_in, 2)
        self.assertEqual(stats.rows_upserted, 1)
        self.assertEqual(stats.rows_rejected, 1)
        self.assertEqual(list(cursor.imported_ledgers.keys()), ["C001"])
        self.assertEqual(cursor.imported_ledgers["C001"]["commercial_balance"], 40.0)
        self.assertEqual(cursor.imported_ledgers["C001"]["email"], "alpha@example.com")
        self.assertIn('"snapshot_table":"imported_customer_ledgers"', stats.metadata_json)
        self.assertIsNotNone(cursor.import_run_insert_params)
        self.assertIsNotNone(cursor.import_run_update_params)


if __name__ == "__main__":
    unittest.main()
