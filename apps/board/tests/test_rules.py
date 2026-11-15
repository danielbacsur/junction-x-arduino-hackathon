import tempfile
import unittest
from rules import Rules, first_word


class Clock:
    now = 0
    def __call__(self):
        return self.now


class RuleTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.clock = Clock()
        self.rules = Rules(self.directory.name, self.clock, lambda: 123456)
        self.rule = {"key": "window", "label": "Window open", "text": "Window open for 5 minutes", "instructions": "Is a window open?", "when": True, "alert": True, "hold": 300000, "temperature": None}
        self.config = {"revision": "1", "questions": [self.rule], "heatedAbove": 18}
        self.rules.update(self.config)

    def tearDown(self):
        self.rules.db.close()
        self.directory.cleanup()

    def sample(self, at, answer="yes", temperature=None):
        self.clock.now = at
        self.rules.observe(self.rule, answer, at, temperature)

    def test_exact_five_minute_hold(self):
        for at in (0, 60, 120, 180, 240, 299.999):
            self.sample(at)
            self.assertEqual(self.rules.queued(), [])
        self.sample(300)
        self.assertEqual(len(self.rules.queued()), 1)
        self.assertFalse(self.rules.snapshot()["questions"][0]["done"])
        self.assertTrue(self.rules.snapshot()["questions"][0]["queued"])

    def test_unknown_and_no_restart_hold(self):
        self.sample(0)
        self.sample(100)
        self.sample(101, "uncertain")
        self.sample(102)
        self.sample(200, "no")
        self.sample(201)
        self.assertEqual(self.rules.snapshot()["questions"][0]["held"], 0)
        self.assertEqual(self.rules.queued(), [])

    def test_outbox_survives_restart_and_is_not_done_until_accepted(self):
        self.rule["hold"] = 0
        self.sample(0)
        event = self.rules.queued()[0]
        other = Rules(self.directory.name, self.clock)
        self.assertEqual(other.queued(), [event])
        self.assertEqual(other.pending(), [])
        other.accepted(event)
        other.db.close()
        self.assertEqual(self.rules.queued(), [])
        self.assertTrue(self.rules.snapshot()["questions"][0]["done"])

    def test_stall_and_restart_do_not_inherit_elapsed_time(self):
        self.sample(0)
        self.sample(301)
        self.assertFalse(self.rules.queued())
        self.assertEqual(self.rules.snapshot()["questions"][0]["held"], 0)
        other = Rules(self.directory.name, self.clock)
        self.assertFalse(other.state)
        other.db.close()

    def test_temperature_missing_threshold_and_setting_reset(self):
        self.rule["temperature"] = {"heated": True}
        self.sample(0, temperature=None)
        self.assertIsNone(self.rules.snapshot()["questions"][0]["yes"])
        self.sample(1, temperature=18)
        self.assertFalse(self.rules.snapshot()["questions"][0]["yes"])
        self.sample(2, temperature=19)
        self.sample(3, temperature=19)
        self.config = {**self.config, "heatedAbove": 20, "revision": "2"}
        self.rules.update(self.config)
        self.assertFalse(self.rules.state)

    def test_late_result_for_deleted_rule_is_ignored(self):
        self.rules.update({**self.config, "questions": []})
        self.sample(0)
        self.assertFalse(self.rules.queued())

    def test_negated_rule_and_recent_vote_counts(self):
        self.rule["when"] = False
        self.rule["alert"] = False
        for at, answer in enumerate(("no", "no", "yes", "no", "no")):
            self.sample(at, answer)
        self.assertEqual(self.rules.snapshot()["questions"][0]["yesCount"], 4)
        self.assertEqual(self.rules.snapshot()["questions"][0]["samples"], 5)

    def test_sensor_expires(self):
        self.rules.sensor(22)
        self.assertEqual(self.rules.temperature_now(), 22)
        self.clock.now = 6
        self.assertIsNone(self.rules.temperature_now())

    def test_parse_first_word_only(self):
        self.assertTrue(first_word(" Yes. Window open"))
        self.assertFalse(first_word("no, closed"))
        for value in ("maybe yes", "yesterday", "<think>yes", "", "unknown"):
            self.assertIsNone(first_word(value))


if __name__ == "__main__":
    unittest.main()
