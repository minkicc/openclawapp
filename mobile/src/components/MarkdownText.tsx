import { Fragment, useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import { appColors } from '../theme/colors';

type MarkdownTextProps = {
  text: string;
  style?: StyleProp<TextStyle>;
  variant?: 'self' | 'peer';
};

type MarkdownNode =
  | {
      type: 'text';
      value: string;
    }
  | {
      type: 'strong' | 'em';
      children: MarkdownNode[];
    }
  | {
      type: 'code';
      value: string;
    };

function parseInlineMarkdown(source: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const strongMarker =
      source.startsWith('**', cursor) || source.startsWith('__', cursor)
        ? source.slice(cursor, cursor + 2)
        : '';
    if (strongMarker) {
      const end = source.indexOf(strongMarker, cursor + 2);
      if (end > cursor + 2) {
        nodes.push({
          type: 'strong',
          children: parseInlineMarkdown(source.slice(cursor + 2, end)),
        });
        cursor = end + 2;
        continue;
      }
    }

    if (source[cursor] === '`') {
      const end = source.indexOf('`', cursor + 1);
      if (end > cursor + 1) {
        nodes.push({
          type: 'code',
          value: source.slice(cursor + 1, end),
        });
        cursor = end + 1;
        continue;
      }
    }

    const emMarker = source[cursor] === '*' || source[cursor] === '_' ? source[cursor] : '';
    if (emMarker) {
      const end = source.indexOf(emMarker, cursor + 1);
      if (end > cursor + 1) {
        nodes.push({
          type: 'em',
          children: parseInlineMarkdown(source.slice(cursor + 1, end)),
        });
        cursor = end + 1;
        continue;
      }
    }

    let nextCursor = cursor + 1;
    while (nextCursor < source.length) {
      if (
        source.startsWith('**', nextCursor) ||
        source.startsWith('__', nextCursor) ||
        source[nextCursor] === '`' ||
        source[nextCursor] === '*' ||
        source[nextCursor] === '_'
      ) {
        break;
      }
      nextCursor += 1;
    }

    nodes.push({
      type: 'text',
      value: source.slice(cursor, nextCursor),
    });
    cursor = nextCursor;
  }

  return nodes.filter((node) => {
    if (node.type === 'text' || node.type === 'code') {
      return node.value.length > 0;
    }
    return node.children.length > 0;
  });
}

function renderMarkdownNodes(
  nodes: MarkdownNode[],
  variant: 'self' | 'peer',
  keyPrefix: string
): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    if (node.type === 'text') {
      return <Fragment key={key}>{node.value}</Fragment>;
    }
    if (node.type === 'code') {
      return (
        <Text
          key={key}
          style={[styles.code, variant === 'self' ? styles.codeSelf : styles.codePeer]}
        >
          {node.value}
        </Text>
      );
    }
    return (
      <Text key={key} style={node.type === 'strong' ? styles.strong : styles.em}>
        {renderMarkdownNodes(node.children, variant, key)}
      </Text>
    );
  });
}

export function MarkdownText({ text, style, variant = 'peer' }: MarkdownTextProps) {
  const lines = useMemo(() => String(text || '').split(/\r?\n/), [text]);

  return (
    <Text style={style}>
      {lines.map((line, index) => (
        <Fragment key={`line-${index}`}>
          {index > 0 ? '\n' : null}
          {renderMarkdownNodes(parseInlineMarkdown(line), variant, `line-${index}`)}
        </Fragment>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  strong: {
    fontWeight: '800',
  },
  em: {
    fontStyle: 'italic',
  },
  code: {
    borderRadius: 8,
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 14,
  },
  codePeer: {
    backgroundColor: appColors.surfaceMuted,
    color: appColors.ink,
  },
  codeSelf: {
    backgroundColor: '#b8e9a3',
    color: appColors.ink,
  },
});
