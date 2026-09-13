from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import (
    StratifiedKFold,
    cross_val_score,
    train_test_split,
)


BASE_DIR = Path(__file__).resolve().parent

DATA_FILE = BASE_DIR / "training_dataset.csv"
MODEL_FILE = BASE_DIR / "landslide_model.pkl"


# ============================================================
# LOAD DATA
# ============================================================

print("=" * 70)
print("RakshaNet - Landslide ML Model Training")
print("=" * 70)

df = pd.read_csv(DATA_FILE)

print()
print(f"Dataset shape: {df.shape}")


# ============================================================
# FEATURES
# ============================================================

FEATURES = [
    "rain_1d",
    "rain_3d",
    "rain_7d",
    "precip_1d",
    "precip_3d",
    "precip_7d",
    "precip_hours_1d",
    "precip_hours_3d",
    "precip_hours_7d",
    "temp_mean",
    "temp_max",
    "temp_min",
    "wind_max",
    "latitude",
    "longitude",
    "month",
]


TARGET = "target"


X = df[FEATURES].copy()
y = df[TARGET].astype(int)


# ============================================================
# BASIC CHECKS
# ============================================================

print()
print("Target distribution:")
print(y.value_counts())


if y.nunique() < 2:
    raise ValueError(
        "Dataset must contain both target classes."
    )


if X.isna().any().any():
    raise ValueError(
        "Feature matrix contains missing values."
    )


# ============================================================
# TRAIN / TEST SPLIT
# ============================================================

X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.20,
    random_state=42,
    stratify=y,
)


print()
print(
    f"Training samples: {len(X_train)}"
)

print(
    f"Testing samples: {len(X_test)}"
)


# ============================================================
# RANDOM FOREST
# ============================================================

model = RandomForestClassifier(
    n_estimators=400,
    max_depth=12,
    min_samples_leaf=3,
    class_weight="balanced",
    random_state=42,
    n_jobs=-1,
)


print()
print("Training Random Forest...")

model.fit(
    X_train,
    y_train
)

print("Training complete.")


# ============================================================
# TEST PREDICTIONS
# ============================================================

y_pred = model.predict(X_test)

y_probability = model.predict_proba(
    X_test
)[:, 1]


accuracy = accuracy_score(
    y_test,
    y_pred
)

precision = precision_score(
    y_test,
    y_pred,
    zero_division=0
)

recall = recall_score(
    y_test,
    y_pred,
    zero_division=0
)

f1 = f1_score(
    y_test,
    y_pred,
    zero_division=0
)

try:
    roc_auc = roc_auc_score(
        y_test,
        y_probability
    )
except ValueError:
    roc_auc = float("nan")


# ============================================================
# RESULTS
# ============================================================

print()
print("=" * 70)
print("TEST RESULTS")
print("=" * 70)

print(
    f"Accuracy : {accuracy:.4f}"
)

print(
    f"Precision: {precision:.4f}"
)

print(
    f"Recall   : {recall:.4f}"
)

print(
    f"F1 Score : {f1:.4f}"
)

print(
    f"ROC-AUC  : {roc_auc:.4f}"
)


print()
print("Confusion Matrix:")

print(
    confusion_matrix(
        y_test,
        y_pred
    )
)


print()
print("Classification Report:")

print(
    classification_report(
        y_test,
        y_pred,
        digits=4,
        zero_division=0
    )
)


# ============================================================
# CROSS VALIDATION
# ============================================================

print()
print("=" * 70)
print("5-FOLD CROSS VALIDATION")
print("=" * 70)


cv = StratifiedKFold(
    n_splits=5,
    shuffle=True,
    random_state=42
)


cv_scores = cross_val_score(
    model,
    X,
    y,
    cv=cv,
    scoring="f1"
)


print(
    "F1 scores:",
    np.round(cv_scores, 4)
)

print(
    f"Mean F1: {cv_scores.mean():.4f}"
)

print(
    f"Std F1 : {cv_scores.std():.4f}"
)


# ============================================================
# FEATURE IMPORTANCE
# ============================================================

importance_df = pd.DataFrame({
    "feature": FEATURES,
    "importance": model.feature_importances_,
})


importance_df = importance_df.sort_values(
    "importance",
    ascending=False
)


print()
print("=" * 70)
print("FEATURE IMPORTANCE")
print("=" * 70)

print(
    importance_df.to_string(
        index=False
    )
)


# ============================================================
# SAVE MODEL
# ============================================================

joblib.dump(
    {
        "model": model,
        "features": FEATURES,
        "version": "rakshanet-landslide-v1",
    },
    MODEL_FILE
)


print()
print("=" * 70)
print("MODEL SAVED")
print("=" * 70)

print(
    MODEL_FILE
)