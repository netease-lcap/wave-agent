# API Contract: AskUserQuestion Tool

## Tool Definition (JSON Schema)

```json
{
  "name": "AskUserQuestion",
  "description": "Asks the user multiple choice questions to gather information, clarify ambiguity, understand preferences, make decisions or offer them choices.",
  "parameters": {
    "type": "object",
    "properties": {
      "questions": {
        "type": "array",
        "minItems": 1,
        "maxItems": 4,
        "items": {
          "type": "object",
          "properties": {
            "question": {
              "type": "string",
              "description": "The complete question to ask the user."
            },
            "header": {
              "type": "string",
              "maxLength": 12,
              "description": "Very short label displayed as a chip/tag (max 12 chars)."
            },
            "options": {
              "type": "array",
              "minItems": 2,
              "maxItems": 4,
              "items": {
                "type": "object",
                "properties": {
                  "label": {
                    "type": "string",
                    "description": "The display text for this option."
                  },
                  "description": {
                    "type": "string",
                    "description": "Explanation of what this option means."
                  }
                },
                "required": ["label"]
              }
            },
            "multiSelect": {
              "type": "boolean",
              "default": false,
              "description": "Allow multiple answers to be selected."
            }
          },
          "required": ["question", "header", "options"]
        }
      }
    },
    "required": ["questions"]
  }
}
```

## Tool Result

```json
{
  "answers": {
    "type": "object",
    "additionalProperties": {
      "type": "string"
    },
    "description": "Mapping of question text to selected answer(s). Multi-select answers are comma-separated."
  }
}
```
