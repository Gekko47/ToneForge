module.exports = {
  "**/*.{ts,tsx}": (files) => [
    `eslint --max-warnings 0 --fix ${files.join(" ")}`,
    `prettier --write ${files.join(" ")}`,
  ],
  "**/*.{json,md,yml,yaml}": (files) => [`prettier --write ${files.join(" ")}`],
};
