import React, { FC } from "react";
import { Text } from "ink";
import { highlight } from "cli-highlight";

export interface HighlightProps {
  code: string;
  language?: string;
  ignoreIllegals?: boolean;
  languageSubset?: string[];
}

export const Highlight: FC<HighlightProps> = ({
  code,
  language,
  ignoreIllegals,
  languageSubset,
}) => {
  return (
    <Text>
      {highlight(code, {
        language,
        ignoreIllegals,
        languageSubset,
      })}
    </Text>
  );
};
