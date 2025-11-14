import React, { FC } from "react";
import { Text } from "ink";
import { highlight } from "cli-highlight";
import chalk from "chalk";

export interface HighlightProps {
  code: string;
  language?: string;
  ignoreIllegals?: boolean;
  languageSubset?: string[];
}

// VS Code theme - inspired by VS Code's default dark theme
const vscodeTheme = {
  keyword: chalk.rgb(86, 156, 214),
  built_in: chalk.rgb(78, 201, 176),
  type: chalk.rgb(78, 201, 176),
  literal: chalk.rgb(86, 156, 214),
  number: chalk.rgb(181, 206, 168),
  regexp: chalk.rgb(209, 105, 105),
  string: chalk.rgb(206, 145, 120),
  subst: chalk.rgb(206, 145, 120),
  symbol: chalk.rgb(220, 220, 170),
  class: chalk.rgb(78, 201, 176),
  function: chalk.rgb(220, 220, 170),
  title: chalk.rgb(220, 220, 170),
  params: chalk.rgb(156, 220, 254),
  comment: chalk.rgb(106, 153, 85),
  doctag: chalk.rgb(106, 153, 85),
  meta: chalk.rgb(86, 156, 214),
  "meta-keyword": chalk.rgb(86, 156, 214),
  "meta-string": chalk.rgb(206, 145, 120),
  section: chalk.rgb(220, 220, 170),
  tag: chalk.rgb(86, 156, 214),
  name: chalk.rgb(92, 207, 230),
  "builtin-name": chalk.rgb(78, 201, 176),
  attr: chalk.rgb(156, 220, 254),
  attribute: chalk.rgb(156, 220, 254),
  variable: chalk.rgb(156, 220, 254),
  bullet: chalk.rgb(212, 212, 212),
  code: chalk.rgb(206, 145, 120),
  emphasis: chalk.rgb(212, 212, 212).italic,
  strong: chalk.rgb(212, 212, 212).bold,
  formula: chalk.rgb(86, 156, 214),
  link: chalk.rgb(156, 220, 254).underline,
  quote: chalk.rgb(106, 153, 85),
  "selector-tag": chalk.rgb(92, 207, 230),
  "selector-id": chalk.rgb(215, 186, 125),
  "selector-class": chalk.rgb(215, 186, 125),
  "selector-attr": chalk.rgb(156, 220, 254),
  "selector-pseudo": chalk.rgb(86, 156, 214),
  "template-tag": chalk.rgb(206, 145, 120),
  "template-variable": chalk.rgb(220, 220, 170),
  addition: chalk.rgb(106, 153, 85),
  deletion: chalk.rgb(244, 71, 71),
};

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
        theme: vscodeTheme,
      })}
    </Text>
  );
};
