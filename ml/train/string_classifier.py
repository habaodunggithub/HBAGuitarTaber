"""Train the string classifier. The code lives in the package so the Kaggle notebook can run it from
the wheel: see taber_ml/training.py, or `taber train-strings --help`.

    uv run python ml/train/string_classifier.py                       # base, on the laptop
    uv run python ml/train/string_classifier.py --size large --seeds 2  # what kaggle/train_strings runs
"""

import sys

from taber_ml.training import main

if __name__ == "__main__":
    sys.exit(main())
