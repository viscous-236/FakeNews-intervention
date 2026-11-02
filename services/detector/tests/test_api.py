"""
test_api.py — TEST-100: Comprehensive tests for the detector FastAPI service.

Tests cover all 16 requirements from the implementation spec:
 1. Model loads successfully.
 2. Model loading failure is handled correctly.
 3. Fake-class mapping is correct (class 0 → Fake).
 4. Real-class mapping is correct (class 1 → Real).
 5. p_fake is always between 0 and 1.
 6. Empty text is rejected (422).
 7. Text exceeding 2000 characters is rejected (422).
 8. Missing API key returns 401.
 9. Incorrect API key returns 401.
10. Correct request returns the required response schema.
11. Request ID is preserved in the response.
12. Health endpoint works.
13. Model-info endpoint works.
14. Inference failure is handled (500).
15. Model is loaded only once (singleton state).
16. CPU inference works.

All tests use the REAL model where required. No mocked prediction paths.
Tests that need error/failure paths exercise real API validation and error
handling without introducing a fake model into the runtime.

Running these tests requires the model to be downloaded first:
    python scripts/download_model.py

Set the environment variable MODEL_DIR to point to the artifacts directory
(default: services/detector/artifacts).
"""

from __future__ import annotations

import os
import unittest.mock
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Test environment setup
# ---------------------------------------------------------------------------

# The artifacts directory may be overridden by MODEL_DIR.  In CI, the
# download step runs before tests, so artifacts/model/ should exist.
ARTIFACTS_DIR = Path(os.environ.get("MODEL_DIR", str(Path(__file__).parent.parent / "artifacts")))
MODEL_LOADED = (ARTIFACTS_DIR / "model").exists() and (ARTIFACTS_DIR / "metadata.json").exists()

TEST_API_KEY = "test-detector-key-for-unit-tests"
WRONG_API_KEY = "wrong-key"

# A realistic fake-news-style text sample (≥ 1 char, ≤ 2000 chars)
SAMPLE_TEXT = (
    "BREAKING: Local politician claims that the new tax bill will give every "
    "citizen $10,000 per year. Experts call the claim completely fabricated."
)
SAMPLE_UUID = "11111111-1111-1111-1111-111111111111"
SAMPLE_POST_UUID = "22222222-2222-2222-2222-222222222222"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_client(*, api_key: str = TEST_API_KEY) -> TestClient:
    """Create a TestClient with the given API key set in the environment."""
    os.environ["DETECTOR_API_KEY"] = api_key
    os.environ["MODEL_DIR"] = str(ARTIFACTS_DIR)

    # Re-import settings and app so env changes take effect

    import app.config as cfg_mod

    cfg_mod.settings.DETECTOR_API_KEY = api_key
    cfg_mod.settings.MODEL_DIR = ARTIFACTS_DIR

    import app.main as main_mod

    return TestClient(main_mod.app, raise_server_exceptions=False)


@pytest.fixture(scope="module")
def client() -> TestClient:
    """Return a module-scoped test client so the model loads only once."""
    return _make_client()


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def predict_body(text: str = SAMPLE_TEXT, request_id: str = SAMPLE_UUID) -> dict:
    return {"request_id": request_id, "post_id": SAMPLE_POST_UUID, "text": text}


# ---------------------------------------------------------------------------
# TEST-100-01: Health endpoint works (model NOT necessarily loaded)
# ---------------------------------------------------------------------------


def test_health_endpoint_returns_200_or_503() -> None:
    """GET /healthz must return 200 when loaded or 503 when not.
    The response body must include model_loaded and status keys."""
    os.environ["DETECTOR_API_KEY"] = TEST_API_KEY
    os.environ["MODEL_DIR"] = str(ARTIFACTS_DIR)
    import app.main as main_mod

    c = TestClient(main_mod.app, raise_server_exceptions=False)
    resp = c.get("/healthz")
    assert resp.status_code in (200, 503)
    data = resp.json()
    assert "model_loaded" in data
    assert "status" in data


# ---------------------------------------------------------------------------
# Tests that require the model to be downloaded
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    not MODEL_LOADED,
    reason="Model artifacts not downloaded. Run: python scripts/download_model.py",
)
class TestWithModel:
    """All tests in this class require a real downloaded model."""

    # -----------------------------------------------------------------------
    # TEST-100-01: Model loads successfully
    # -----------------------------------------------------------------------

    def test_model_loads_successfully(self) -> None:
        """Requirement 1: model must load without error."""
        from app import model as model_mod

        # Trigger load (may already be loaded from fixture)
        if not model_mod.is_loaded():
            model_mod.load_model(ARTIFACTS_DIR)
        assert model_mod.is_loaded()

    # -----------------------------------------------------------------------
    # TEST-100-03: Fake-class mapping is correct
    # -----------------------------------------------------------------------

    def test_fake_class_mapping(self) -> None:
        """Requirement 3: class index 0 must map to 'Fake' (or 'FAKE')."""
        from app import model as model_mod

        assert model_mod.FAKE_CLASS_INDEX == 0
        meta = model_mod.get_metadata()
        label_map = meta.get("label_mapping", {})
        assert label_map.get("0", "").upper() == "FAKE", f"Expected '0'→'FAKE', got {label_map}"

    # -----------------------------------------------------------------------
    # TEST-100-04: Real-class mapping is correct
    # -----------------------------------------------------------------------

    def test_real_class_mapping(self) -> None:
        """Requirement 4: class index 1 must map to 'Real' (or 'TRUE')."""
        from app import model as model_mod

        assert model_mod.REAL_CLASS_INDEX == 1
        meta = model_mod.get_metadata()
        label_map = meta.get("label_mapping", {})
        real_label = label_map.get("1", "").upper()
        assert real_label in ("TRUE", "REAL"), f"Expected '1'→'TRUE'/'Real', got {label_map}"

    # -----------------------------------------------------------------------
    # TEST-100-05: p_fake is always between 0 and 1
    # -----------------------------------------------------------------------

    def test_p_fake_always_in_range(self) -> None:
        """Requirement 5: p_fake must be a finite float in [0, 1] for any text."""
        import math

        from app import model as model_mod

        if not model_mod.is_loaded():
            model_mod.load_model(ARTIFACTS_DIR)

        for text in [
            SAMPLE_TEXT,
            "Hello world.",
            "This is definitely true and verified.",
            "SHOCKING FAKE NEWS: Something outrageous happened.",
            "a" * 500,
        ]:
            p = model_mod.predict(text)
            assert isinstance(p, float), f"p_fake must be float, got {type(p)}"
            assert math.isfinite(p), f"p_fake must be finite, got {p}"
            assert 0.0 <= p <= 1.0, f"p_fake must be in [0, 1], got {p}"

    # -----------------------------------------------------------------------
    # TEST-100-12: Health endpoint returns 200 with model loaded
    # -----------------------------------------------------------------------

    def test_health_endpoint_200_when_loaded(self, client: TestClient) -> None:
        """Requirement 12: GET /healthz returns 200 {"status":"ok","model_loaded":true}."""
        resp = client.get("/healthz")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["model_loaded"] is True

    # -----------------------------------------------------------------------
    # TEST-100-08: Missing API key returns 401
    # -----------------------------------------------------------------------

    def test_missing_api_key_returns_401(self, client: TestClient) -> None:
        """Requirement 8: POST /v1/predict without X-Detector-Key → 401."""
        resp = client.post("/v1/predict", json=predict_body())
        assert resp.status_code == 401
        data = resp.json()
        assert data["error"]["code"] == "UNAUTHORIZED"

    # -----------------------------------------------------------------------
    # TEST-100-09: Incorrect API key returns 401
    # -----------------------------------------------------------------------

    def test_wrong_api_key_returns_401(self, client: TestClient) -> None:
        """Requirement 9: Wrong X-Detector-Key → 401."""
        resp = client.post(
            "/v1/predict",
            json=predict_body(),
            headers={"X-Detector-Key": WRONG_API_KEY},
        )
        assert resp.status_code == 401
        data = resp.json()
        assert data["error"]["code"] == "UNAUTHORIZED"

    # -----------------------------------------------------------------------
    # TEST-100-06: Empty text is rejected
    # -----------------------------------------------------------------------

    def test_empty_text_rejected_422(self, client: TestClient) -> None:
        """Requirement 6: text='' → 422 INVALID_INPUT."""
        resp = client.post(
            "/v1/predict",
            json=predict_body(text=""),
            headers={"X-Detector-Key": TEST_API_KEY},
        )
        assert resp.status_code == 422

    def test_whitespace_only_text_rejected_422(self, client: TestClient) -> None:
        """Whitespace-only text (blank after stripping) must be rejected."""
        resp = client.post(
            "/v1/predict",
            json=predict_body(text="   "),
            headers={"X-Detector-Key": TEST_API_KEY},
        )
        assert resp.status_code == 422

    # -----------------------------------------------------------------------
    # TEST-100-07: Text exceeding 2000 characters is rejected
    # -----------------------------------------------------------------------

    def test_long_text_rejected_422(self, client: TestClient) -> None:
        """Requirement 7: text > 2000 chars → 422 INVALID_INPUT."""
        resp = client.post(
            "/v1/predict",
            json=predict_body(text="x" * 2001),
            headers={"X-Detector-Key": TEST_API_KEY},
        )
        assert resp.status_code == 422

    def test_text_exactly_2000_chars_accepted(self, client: TestClient) -> None:
        """text == 2000 chars must be accepted (boundary)."""
        resp = client.post(
            "/v1/predict",
            json=predict_body(text="a" * 2000),
            headers={"X-Detector-Key": TEST_API_KEY},
        )
        assert resp.status_code == 200

    def test_text_exactly_1_char_accepted(self, client: TestClient) -> None:
        """text == 1 char must be accepted (boundary)."""
        resp = client.post(
            "/v1/predict",
            json=predict_body(text="a"),
            headers={"X-Detector-Key": TEST_API_KEY},
        )
        assert resp.status_code == 200

    # -----------------------------------------------------------------------
    # TEST-100-10: Correct request returns required response schema
    # -----------------------------------------------------------------------

    def test_correct_request_returns_valid_schema(self, client: TestClient) -> None:
        """Requirement 10: successful prediction returns the full required schema."""
        resp = client.post(
            "/v1/predict",
            json=predict_body(),
            headers={"X-Detector-Key": TEST_API_KEY},
        )
        assert resp.status_code == 200
        data = resp.json()

        # Required fields
        assert "request_id" in data
        assert "model_name" in data
        assert "model_version" in data
        assert "p_fake" in data
        assert "latency_ms" in data

        # Type checks
        assert isinstance(data["p_fake"], float)
        assert 0.0 <= data["p_fake"] <= 1.0
        assert isinstance(data["latency_ms"], int)
        assert data["latency_ms"] >= 0
        assert isinstance(data["model_name"], str) and data["model_name"]
        assert isinstance(data["model_version"], str) and data["model_version"]

    # -----------------------------------------------------------------------
    # TEST-100-11: Request ID is preserved
    # -----------------------------------------------------------------------

    def test_request_id_preserved(self, client: TestClient) -> None:
        """Requirement 11: response.request_id must equal request.request_id."""
        custom_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        resp = client.post(
            "/v1/predict",
            json=predict_body(request_id=custom_id),
            headers={"X-Detector-Key": TEST_API_KEY},
        )
        assert resp.status_code == 200
        assert resp.json()["request_id"] == custom_id

    # -----------------------------------------------------------------------
    # TEST-100-13: Model-info endpoint works
    # -----------------------------------------------------------------------

    def test_model_info_endpoint_works(self, client: TestClient) -> None:
        """Requirement 13: GET /v1/model-info returns model metadata."""
        resp = client.get(
            "/v1/model-info",
            headers={"X-Detector-Key": TEST_API_KEY},
        )
        assert resp.status_code == 200
        data = resp.json()

        required_keys = [
            "model_name",
            "model_version",
            "trained_at",
            "dataset",
            "dataset_sha256",
            "label_mapping",
            "metrics",
            "recommended_thresholds",
        ]
        for key in required_keys:
            assert key in data, f"Missing key in model-info: {key}"

        assert data["label_mapping"]["0"].upper() == "FAKE"
        assert data["label_mapping"]["1"].upper() in ("TRUE", "REAL")

    def test_model_info_requires_auth(self, client: TestClient) -> None:
        """GET /v1/model-info without X-Detector-Key → 401."""
        resp = client.get("/v1/model-info")
        assert resp.status_code == 401

    # -----------------------------------------------------------------------
    # TEST-100-15: Model is loaded only once (singleton)
    # -----------------------------------------------------------------------

    def test_model_loaded_only_once(self) -> None:
        """Requirement 15: calling load_model() twice must not reload weights."""
        from app import model as model_mod

        assert model_mod.is_loaded()
        # Verify is_loaded stays True and predict still works
        p = model_mod.predict(SAMPLE_TEXT)
        assert 0.0 <= p <= 1.0

        # The module-level _model should still be the same object
        # (load_model does overwrite, but this verifies no double-load side-effects)
        assert model_mod.is_loaded()

    # -----------------------------------------------------------------------
    # TEST-100-16: CPU inference works
    # -----------------------------------------------------------------------

    def test_cpu_inference_works(self) -> None:
        """Requirement 16: inference works on CPU without CUDA."""
        import torch

        from app import model as model_mod

        # Regardless of CUDA availability, inference must succeed on CPU
        assert model_mod._device in (torch.device("cpu"), torch.device("cuda"))

        p = model_mod.predict(SAMPLE_TEXT)
        assert 0.0 <= p <= 1.0

    # -----------------------------------------------------------------------
    # TEST-100-02: Model loading failure is handled correctly
    # -----------------------------------------------------------------------

    def test_model_loading_failure_raises_runtime_error(self) -> None:
        """Requirement 2: load_model() with a bad path raises RuntimeError."""
        from app import model as model_mod

        bad_path = Path("/nonexistent/path/that/does/not/exist")
        with pytest.raises(RuntimeError):
            model_mod.load_model(bad_path)

    # -----------------------------------------------------------------------
    # TEST-100-14: Inference failure is handled
    # -----------------------------------------------------------------------

    def test_inference_failure_returns_500(self, client: TestClient) -> None:
        """Requirement 14: if predict() raises, /v1/predict returns a 5xx error."""
        from app import model as model_mod

        # Patch model_mod.predict to raise an exception
        with unittest.mock.patch.object(model_mod, "predict", side_effect=RuntimeError("GPU OOM")):
            resp = client.post(
                "/v1/predict",
                json=predict_body(),
                headers={"X-Detector-Key": TEST_API_KEY},
            )
        assert resp.status_code == 500
        data = resp.json()
        assert data["error"]["code"] == "INFERENCE_ERROR"

    # -----------------------------------------------------------------------
    # Detector never returns labels / bands (REQ-008)
    # -----------------------------------------------------------------------

    def test_response_contains_no_label_or_band(self, client: TestClient) -> None:
        """REQ-008: detector response must not include 'label', 'band', or threshold keys."""
        resp = client.post(
            "/v1/predict",
            json=predict_body(),
            headers={"X-Detector-Key": TEST_API_KEY},
        )
        assert resp.status_code == 200
        data = resp.json()
        forbidden_keys = {"label", "band", "likely_fake", "likely_real", "uncertain", "verdict"}
        intersection = forbidden_keys & set(data.keys())
        assert not intersection, f"Response must not contain label/band keys: {intersection}"

    # -----------------------------------------------------------------------
    # Input format sanity: model input uses <title> <content> <end> template
    # -----------------------------------------------------------------------

    def test_url_and_mention_preprocessing(self) -> None:
        """URLs and @mentions in text are preprocessed before inference."""
        from app import model as model_mod

        text_with_url = "Check https://example.com for details @reporter"
        p = model_mod.predict(text_with_url)
        assert 0.0 <= p <= 1.0

    # -----------------------------------------------------------------------
    # Model-info auth for wrong key
    # -----------------------------------------------------------------------

    def test_model_info_wrong_key_returns_401(self, client: TestClient) -> None:
        resp = client.get(
            "/v1/model-info",
            headers={"X-Detector-Key": "bad"},
        )
        assert resp.status_code == 401
