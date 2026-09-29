# Bundled PlantVillage model

- `prithvi_mobilenetv3_plantvillage.tflite` is the selected MobileNetV3Large PlantVillage 38-class quantized TFLite model from [MustafaBeratYavas/Plant-Disease-Edge-AI-Diagnosis-System](https://github.com/MustafaBeratYavas/Plant-Disease-Edge-AI-Diagnosis-System), `mobile/assets/models/best_model_quantized.tflite`.
- `plantvillage_labels.txt` is that repository's matching `mobile/assets/labels.txt`, preserving model output order.
- Upstream describes 224×224×3 RGB input, raw RGB 0–255 float32 public input, MobileNetV3 preprocessing embedded in the graph, and a 38-way softmax output. The runtime independently checks the loaded tensor count, shapes, and data types, and validates that output is a probability distribution before mapping labels.
- This closed-world PlantVillage classifier may be unreliable on unfamiliar crops and real field imagery. It is an AI screening aid only, not a confirmed diagnosis.
