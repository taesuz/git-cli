import readline from 'readline';

export async function confirm(question: string, defaultValue: boolean = true): Promise<boolean> {
  const options = ['예 (Yes)', '아니오 (No)'];
  let selectedIndex = defaultValue ? 0 : 1;

  console.log(`\n${question}`);

  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      console.log(`(Non-interactive TTY mode detected. Defaulting to: ${defaultValue})`);
      resolve(defaultValue);
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    process.stdin.setRawMode(true);
    readline.emitKeypressEvents(process.stdin);

    let renderedLines = 0;

    const render = () => {
      // Clear previously rendered lines
      if (renderedLines > 0) {
        readline.moveCursor(process.stdout, 0, -renderedLines);
        readline.clearScreenDown(process.stdout);
      }

      options.forEach((opt, idx) => {
        const isSelected = idx === selectedIndex;
        if (isSelected) {
          process.stdout.write(` \x1b[36m\x1b[1m❯ ${opt}\x1b[0m\n`);
        } else {
          process.stdout.write(`   ${opt}\n`);
        }
      });

      renderedLines = options.length;
    };

    render();

    const onKeypress = (_str: string, key: readline.Key) => {
      if (!key) return;

      if (key.name === 'up' || key.name === 'left' || key.name === 'k') {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        render();
      } else if (key.name === 'down' || key.name === 'right' || key.name === 'j') {
        selectedIndex = (selectedIndex + 1) % options.length;
        render();
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        process.stdout.write('\n');
        resolve(selectedIndex === 0);
      } else if (key.ctrl && key.name === 'c') {
        cleanup();
        console.log('\n[git-cli] 작업이 취소되었습니다.');
        process.exit(0);
      }
    };

    const cleanup = () => {
      process.stdin.removeListener('keypress', onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      rl.close();
    };

    process.stdin.on('keypress', onKeypress);
  });
}

export async function selectChoice(question: string, options: string[], defaultIndex: number = 0): Promise<number> {
  let selectedIndex = defaultIndex;

  console.log(`\n${question}`);

  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve(defaultIndex);
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    process.stdin.setRawMode(true);
    readline.emitKeypressEvents(process.stdin);

    let renderedLines = 0;

    const render = () => {
      if (renderedLines > 0) {
        readline.moveCursor(process.stdout, 0, -renderedLines);
        readline.clearScreenDown(process.stdout);
      }

      options.forEach((opt, idx) => {
        const isSelected = idx === selectedIndex;
        if (isSelected) {
          process.stdout.write(` \x1b[36m\x1b[1m❯ ${opt}\x1b[0m\n`);
        } else {
          process.stdout.write(`   ${opt}\n`);
        }
      });

      renderedLines = options.length;
    };

    render();

    const onKeypress = (_str: string, key: readline.Key) => {
      if (!key) return;

      if (key.name === 'up' || key.name === 'left' || key.name === 'k') {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        render();
      } else if (key.name === 'down' || key.name === 'right' || key.name === 'j') {
        selectedIndex = (selectedIndex + 1) % options.length;
        render();
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        process.stdout.write('\n');
        resolve(selectedIndex);
      } else if (key.ctrl && key.name === 'c') {
        cleanup();
        console.log('\n[git-cli] 작업이 취소되었습니다.');
        process.exit(0);
      }
    };

    const cleanup = () => {
      process.stdin.removeListener('keypress', onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      rl.close();
    };

    process.stdin.on('keypress', onKeypress);
  });
}

export async function promptInput(question: string, defaultValue: string): Promise<string> {
  console.log(`\n${question}`);
  console.log(`\x1b[90m(엔터를 누르면 기본값 '${defaultValue}' 이(가) 사용됩니다)\x1b[0m`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(' ❯ 입력: ', (answer) => {
      rl.close();
      const trimmed = answer.trim();
      if (trimmed === '') {
        resolve(defaultValue);
      } else {
        resolve(trimmed);
      }
    });
  });
}

export interface MultiChoiceOption {
  label: string;
  details?: string[];
}

export async function selectMultiChoices(
  question: string,
  options: MultiChoiceOption[]
): Promise<number[]> {
  let cursorIndex = 0;
  const selectedIndexes = new Set<number>();

  console.log(`\n${question}`);
  console.log(`\x1b[90m(↑/↓: 이동 | Space: 체크/해제 [x] | Enter: 선택 완료)\x1b[0m\n`);

  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve([]);
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    process.stdin.setRawMode(true);
    readline.emitKeypressEvents(process.stdin);

    let renderedLines = 0;

    const render = () => {
      if (renderedLines > 0) {
        readline.moveCursor(process.stdout, 0, -renderedLines);
        readline.clearScreenDown(process.stdout);
      }

      let lineCount = 0;
      options.forEach((opt, idx) => {
        const isFocused = idx === cursorIndex;
        const isChecked = selectedIndexes.has(idx);
        const checkbox = isChecked ? '[\x1b[32m✔\x1b[0m]' : '[ ]';
        const focusPrefix = isFocused ? '\x1b[36m\x1b[1m❯\x1b[0m ' : '  ';

        if (isFocused) {
          process.stdout.write(`${focusPrefix}${checkbox} \x1b[36m\x1b[1m${opt.label}\x1b[0m\n`);
        } else {
          process.stdout.write(`${focusPrefix}${checkbox} ${opt.label}\n`);
        }
        lineCount++;

        if (opt.details && opt.details.length > 0) {
          opt.details.forEach((detail) => {
            process.stdout.write(`      ${detail}\n`);
            lineCount++;
          });
        }

        if (idx < options.length - 1) {
          process.stdout.write('\n');
          lineCount++;
        }
      });

      renderedLines = lineCount;
    };

    render();

    const onKeypress = (_str: string, key: readline.Key) => {
      if (!key) return;

      if (key.name === 'up' || key.name === 'k') {
        cursorIndex = (cursorIndex - 1 + options.length) % options.length;
        render();
      } else if (key.name === 'down' || key.name === 'j') {
        cursorIndex = (cursorIndex + 1) % options.length;
        render();
      } else if (key.name === 'space') {
        if (selectedIndexes.has(cursorIndex)) {
          selectedIndexes.delete(cursorIndex);
        } else {
          selectedIndexes.add(cursorIndex);
        }
        render();
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        process.stdout.write('\n');
        resolve(Array.from(selectedIndexes).sort((a, b) => a - b));
      } else if (key.ctrl && key.name === 'c') {
        cleanup();
        console.log('\n[git-cli] 작업이 취소되었습니다.');
        process.exit(0);
      }
    };

    const cleanup = () => {
      process.stdin.removeListener('keypress', onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      rl.close();
    };

    process.stdin.on('keypress', onKeypress);
  });
}
