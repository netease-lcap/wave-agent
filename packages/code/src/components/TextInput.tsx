import React, { useState, useEffect } from "react";
import { Text, useInput } from "ink";

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isFocused?: boolean;
}

export const TextInput: React.FC<TextInputProps> = ({
  value,
  onChange,
  placeholder = "",
  isFocused = false,
}) => {
  const [cursorOffset, setCursorOffset] = useState(value.length);

  // Keep cursor in bounds if value changes externally
  useEffect(() => {
    if (isFocused) {
      setCursorOffset(value.length);
    }
  }, [isFocused, value.length]);

  useEffect(() => {
    if (cursorOffset > value.length) {
      setCursorOffset(value.length);
    }
  }, [value, cursorOffset]);

  useInput(
    (input, key) => {
      if (!isFocused) return;

      if (key.leftArrow) {
        setCursorOffset((prev) => Math.max(0, prev - 1));
        return;
      }

      if (key.rightArrow) {
        setCursorOffset((prev) => Math.min(value.length, prev + 1));
        return;
      }

      if (key.backspace || key.delete) {
        if (cursorOffset > 0) {
          const newValue =
            value.slice(0, cursorOffset - 1) + value.slice(cursorOffset);
          const newOffset = cursorOffset - 1;
          onChange(newValue);
          setCursorOffset(newOffset);
        }
        return;
      }

      // Handle normal character input
      if (input && !key.ctrl && !key.meta && !key.return && !key.escape) {
        const newValue =
          value.slice(0, cursorOffset) + input + value.slice(cursorOffset);
        const newOffset = cursorOffset + input.length;
        onChange(newValue);
        setCursorOffset(newOffset);
      }
    },
    { isActive: isFocused },
  );

  const renderValue = () => {
    if (value.length === 0 && placeholder) {
      return (
        <Text color="gray" dimColor>
          {isFocused ? (
            <Text backgroundColor="white" color="black">
              {" "}
            </Text>
          ) : (
            ""
          )}
          {placeholder}
        </Text>
      );
    }

    const beforeCursor = value.slice(0, cursorOffset);
    const atCursor = value.slice(cursorOffset, cursorOffset + 1) || " ";
    const afterCursor = value.slice(cursorOffset + 1);

    return (
      <Text>
        {beforeCursor}
        {isFocused ? (
          <Text backgroundColor="white" color="black">
            {atCursor}
          </Text>
        ) : atCursor === " " && cursorOffset === value.length ? (
          ""
        ) : (
          atCursor
        )}
        {afterCursor}
      </Text>
    );
  };

  return <Text>{renderValue()}</Text>;
};
