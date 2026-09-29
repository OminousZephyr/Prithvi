import unittest
from io import BytesIO

from PIL import Image

from inference.predictor import UnavailablePredictor, load_predictor
from inference.preprocess import preprocess_image
from inference.service import analyze_image


def make_image(size=(240, 240)):
    output = BytesIO()
    Image.new("RGB", size, color=(90, 130, 70)).save(output, format="JPEG")
    return output.getvalue()


class InferencePipelineTests(unittest.TestCase):
    def test_valid_image_is_decoded_without_claiming_crop_health(self):
        result = preprocess_image(make_image())
        self.assertEqual(result.status, "acceptable")
        self.assertEqual(result.image.size, (240, 240))
        self.assertEqual(load_predictor().predict(result.image).status, "unavailable")

    def test_small_image_fails_quality_gate(self):
        result = preprocess_image(make_image((30, 30)))
        self.assertEqual(result.status, "low")
        self.assertIsNone(result.image)

    def test_malformed_and_empty_images_fail_without_crashing(self):
        self.assertEqual(preprocess_image(b"not an image").status, "low")
        self.assertEqual(preprocess_image(b"").status, "low")

    def test_predictor_explicitly_abstains_without_model(self):
        result = UnavailablePredictor().predict(None)
        self.assertEqual(result.reason, "No trained model installed")
        self.assertIsNone(result.confidence)

    def test_api_response_remains_unavailable_without_model(self):
        result = analyze_image(make_image(), load_predictor(), "2026-01-01T00:00:00Z")
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["reason"], "No trained model installed")
        self.assertIsNone(result["confidence"])
        self.assertEqual(result["image_quality"]["status"], "acceptable")

    def test_low_quality_image_abstains_before_predictor(self):
        result = analyze_image(make_image((40, 40)), load_predictor())
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["image_quality"]["status"], "low")
        self.assertEqual(result["reason"], "Image quality too low")

    def test_service_accepts_only_complete_bounded_real_model_result_shape(self):
        class TestPredictor:
            available = True

            def predict(self, _image):
                from inference.predictor import Prediction
                return Prediction("possible_issue", crop="unknown", condition="unknown",
                                  confidence=0.81, observation="Possible visible crop-health anomaly",
                                  model_version="test-adapter-v1")

        result = analyze_image(make_image(), TestPredictor())
        self.assertEqual(result["status"], "possible_issue")
        self.assertEqual(result["model_version"], "test-adapter-v1")
        self.assertEqual(result["source"], "esp32_cam_rgb")


if __name__ == "__main__":
    unittest.main()
