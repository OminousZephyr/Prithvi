# PRITHVI on-device crop-health screening

Crop-health scanning runs in the PRITHVI Android app with `react-native-fast-tflite`. The bundled MobileNetV3Large PlantVillage model is the primary runtime. The local FastAPI service remains an optional developer fallback and is disabled by default; ordinary scanning does not ping it and does not require a laptop or internet connection.

## Bundled model and input contract

- Model: `assets/models/prithvi_mobilenetv3_plantvillage.tflite`, from the selected [Plant-Disease-Edge-AI-Diagnosis-System repository](https://github.com/MustafaBeratYavas/Plant-Disease-Edge-AI-Diagnosis-System).
- Labels: `assets/models/plantvillage_labels.txt`, the matching ordered 38-class label file from that repository. Startup rejects a missing or malformed label set.
- Runtime: CPU delegate (the TFLite library default); no GPU delegate is enabled.
- Input checked at runtime: one `float32` tensor shaped `[1, 224, 224, 3]`.
- Preprocessing: decode JPEG to RGB, bilinear resize to 224x224, then interleave raw float RGB values from 0 through 255. No `/255` scaling or other normalization is applied because the published model embeds MobileNetV3 preprocessing.
- Output checked at runtime: one `float32` tensor shaped `[1, 38]`. Values must be finite probabilities summing to approximately 1; the model already has a softmax output, so the app does not apply a second softmax.
- Initial confidence threshold: `0.65`. Lower top-class confidence is shown as uncertain. This threshold does not establish clinical/agronomic certainty.

The class list is closed-world PlantVillage data. A high score on an unfamiliar crop, field image, or condition can still be misleading. Results are AI screening observations, not diagnoses; inspect the area manually. The app does not claim performance on PRITHVI drone or outdoor imagery based on the source dataset results.

## Development build

Expo Go does not include the native TFLite runtime. Use a custom development build:

```powershell
npm install
npx expo config --type prebuild
npx expo prebuild --platform android
npx expo run:android
```

The TFLite Expo config plugin is already declared in `app.json`, and Metro bundles `.tflite` and `.txt` assets. The generated `android/` folder is build output; make native configuration changes through Expo config/plugins. A native build requires a working Android SDK and Java toolchain.

Web preview remains available for the rest of the app, but its crop-scan runtime intentionally reports on-device TFLite as unavailable. A native development build is required to run inference.

## Optional local server

The FastAPI service under `prithvi-ai/` is optional and disabled for inference by default. Settings may enable it as an explicit fallback when on-device model loading fails. It is not checked before local inference, and its results are not persisted as validated on-device observations.

## Sample image

No sample image is bundled. The development-only “Analyze sample image” action clearly reports “No test image installed.” To enable it, add a real, properly licensed JPEG at `assets/test/plant-test.jpg` and wire that bundled asset into the sample URI in the scan route. The sample must use the same on-device provider as camera captures; do not add example predictions or synthetic output.
