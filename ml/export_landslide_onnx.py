from pathlib import Path
import joblib
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType


BASE_DIR = Path(__file__).resolve().parent

MODEL_FILE = BASE_DIR / "landslide_model.pkl"
OUTPUT_FILE = BASE_DIR / "landslide_model.onnx"


data = joblib.load(MODEL_FILE)

model = data["model"]
features = data["features"]

initial_type = [
    (
        "float_input",
        FloatTensorType([None, len(features)])
    )
]

onnx_model = convert_sklearn(
    model,
    initial_types=initial_type,
    options={
        id(model): {
            "zipmap": False
        }
    }
)

with open(
    OUTPUT_FILE,
    "wb"
) as f:
    f.write(
        onnx_model.SerializeToString()
    )

print("ONNX model exported successfully.")
print("Features:", features)
print("Output:", OUTPUT_FILE)