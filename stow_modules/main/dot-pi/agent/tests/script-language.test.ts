import { describe, expect, test } from "bun:test";
import { languageForPath, scriptSegments } from "../extensions/open-tui/script-language.ts";

function segments(command: string) {
	const result = scriptSegments(command);
	expect(result.map((segment) => segment.source).join("")).toBe(command);
	return result;
}

function code(command: string) {
	return segments(command).filter((segment) => segment.language !== "bash");
}

function shell(command: string) {
	expect(segments(command)).toEqual([{ source: command, language: "bash" }]);
}

describe("languageForPath", () => {
	test.each([
		["tool.py", "python"], ["types.pyi", "python"], ["app.rb", "ruby"], ["lib.rs", "rust"],
		["main.c", "c"], ["main.h", "c"], ["main.cpp", "cpp"], ["main.cc", "cpp"], ["main.hpp", "cpp"],
		["Main.java", "java"], ["index.php", "php"], ["index.js", "javascript"], ["index.mjs", "javascript"],
		["app.jsx", "javascript"], ["app.ts", "typescript"], ["app.tsx", "typescript"], ["app.mts", "typescript"],
		["analysis.R", "r"], ["query.sql", "sql"], ["main.go", "go"], ["setup.sh", "bash"], ["setup.zsh", "bash"],
		["setup.fish", "bash"], ["setup.ps1", "powershell"], ["setup.bat", "dos"],
		["data.json", "json"], ["data.yaml", "yaml"], ["data.yml", "yaml"], ["index.html", "xml"], ["style.css", "css"],
		["init.lua", "lua"], ["main.pl", "perl"], ["Main.swift", "swift"], ["main.kt", "kotlin"], ["main.kts", "kotlin"],
		["Main.cs", "csharp"], ["main.dart", "dart"], ["config.toml", "toml"], ["Main.scala", "scala"],
		["/tmp/a b/script.PY", "python"], ["C:\\project\\script.rb", "ruby"], ["./.bashrc", "bash"],
		["Gemfile", "ruby"], ["Dockerfile", "dockerfile"], ["Makefile", "makefile"],
	])("%s uses %s", (path, language) => expect(languageForPath(path)).toBe(language));

	test.each(["", "README", "a.unknown", "/folder.py/README", "/folder.py/", "abashrc", "data.txt", "data.constructor", "data.__proto__"])("does not guess %s", (path) => {
		expect(languageForPath(path)).toBeUndefined();
	});
});

describe("inline interpreter code", () => {
	test("Python inner source only; prefix, quotes and suffix remain shell", () => {
		const command = "python3 -c 'print(\"hello\")' > output.txt";
		expect(segments(command)).toEqual([
			{ source: "python3 -c '", language: "bash" },
			{ source: 'print("hello")', language: "python" },
			{ source: "' > output.txt", language: "bash" },
		]);
	});

	test("Ruby double quotes and shell escapes are kept verbatim", () => {
		const command = String.raw`ruby -e "puts \"hello\"" && echo done`;
		expect(code(command)).toEqual([{ source: String.raw`puts \"hello\"`, language: "ruby" }]);
	});

	test.each([
		["python", "-c", "python"], ["python3.12", "-c", "python"], ["/usr/bin/python3", "-c", "python"],
		["ruby3.3", "-e", "ruby"], ["node", "-e", "javascript"], ["node", "--eval", "javascript"],
		["bun", "-e", "javascript"], ["ts-node", "-e", "typescript"], ["tsx", "--eval", "typescript"],
		["R", "-e", "r"], ["Rscript", "-e", "r"], ["php", "-r", "php"], ["perl", "-E", "perl"],
		["lua5.4", "-e", "lua"], ["swift", "-e", "swift"], ["kotlin", "-e", "kotlin"], ["scala", "-e", "scala"],
		["psql", "-c", "sql"], ["mysql", "--execute", "sql"], ["sqlite3", "-cmd", "sql"],
	])("%s %s recognizes quoted code", (executable, flag, language) => {
		expect(code(executable + " " + flag + " 'some source'")).toEqual([{ source: "some source", language }]);
	});

	test("attached quoted arguments and eval subcommand", () => {
		expect(code("python -c'print(1)'" )).toEqual([{ source: "print(1)", language: "python" }]);
		expect(code("node --eval='console.log(1)'" )).toEqual([{ source: "console.log(1)", language: "javascript" }]);
		expect(code("deno eval 'console.log(1)'" )).toEqual([{ source: "console.log(1)", language: "javascript" }]);
	});

	test("multiple commands and multiple Ruby -e switches", () => {
		const command = "echo before; python3 -c 'print(1)' && ruby -e 'puts 2' -e 'puts 3' | cat\necho after";
		expect(code(command)).toEqual([
			{ source: "print(1)", language: "python" },
			{ source: "puts 2", language: "ruby" },
			{ source: "puts 3", language: "ruby" },
		]);
	});

	test("Python arguments after its inline source are string data", () => {
		expect(code("python -c 'print(1)' -c 'string data'")).toEqual([{ source: "print(1)", language: "python" }]);
	});

	test("assignments, simple env wrapper, continuations and multiline source", () => {
		expect(code("LANG=C env PYTHONUTF8=1 /usr/bin/python3 -u \\\n-c 'print(1)\nprint(2)'\n")).toEqual([
			{ source: "print(1)\nprint(2)", language: "python" },
		]);
	});
});

describe("heredocs", () => {
	test.each(["<<EOF", "<<'EOF'", '<<"EOF"', "<<-EOF"])("Python %s preserves body, delimiter and following shell", (operator) => {
		const command = "python3 - " + operator + "\nprint(1)\n\nEOF\necho done\n";
		expect(segments(command)).toEqual([
			{ source: "python3 - " + operator + "\n", language: "bash" },
			{ source: "print(1)\n\n", language: "python" },
			{ source: "EOF\necho done\n", language: "bash" },
		]);
	});

	test.each([
		["python3 -", "python"], ["ruby", "ruby"], ["rustc -", "rust"], ["go run /dev/stdin", "go"],
		["gcc -x c -", "c"], ["cc -", "c"], ["g++ -x c++ -", "cpp"], ["c++ -", "cpp"],
		["java", "java"], ["jshell", "java"], ["php", "php"], ["node", "javascript"],
		["deno run -", "javascript"], ["bun run -", "javascript"], ["ts-node", "typescript"], ["tsx", "typescript"],
		["R --vanilla", "r"], ["Rscript -", "r"], ["sqlite3 :memory:", "sql"], ["psql -d app", "sql"], ["mysql", "sql"],
		["perl", "perl"], ["lua", "lua"], ["swift -", "swift"], ["kotlin", "kotlin"], ["scala", "scala"],
	])("%s infers stdin language %s", (header, language) => {
		expect(code(header + " <<EOF\nsome source\nEOF\n")).toEqual([{ source: "some source\n", language }]);
	});

	test("R and Go bodies are independent of delimiter names", () => {
		expect(code("R --vanilla <<DATA\nprint(1)\nDATA\n")).toEqual([{ source: "print(1)\n", language: "r" }]);
		expect(code("go run /dev/stdin <<'SRC'\npackage main\nfunc main() {}\nSRC\n")).toEqual([
			{ source: "package main\nfunc main() {}\n", language: "go" },
		]);
	});

	test.each(["script.py", "script.rb", "script.rs", "script.cpp", "Main.java", "index.php", "app.ts", "main.go", "analysis.R", "query.sql"])("output path %s infers the body", (path) => {
		expect(code("cat >'dir/" + path + "' <<EOF\nsource\nEOF\n")).toEqual([
			{ source: "source\n", language: languageForPath(path)! },
		]);
	});

	test("redirection before executable and adjacent numeric file descriptors", () => {
		expect(code("2>/dev/null >script.py cat <<'PY'\nprint(1)\nPY")).toEqual([{ source: "print(1)\n", language: "python" }]);
	});

	test("tabs, CRLF and final delimiter without newline remain exact", () => {
		const command = 'python <<-"EOF"\r\n\tprint("🙂")\r\n\t\r\n\tEOF';
		expect(code(command)).toEqual([{ source: '\tprint("🙂")\r\n\t\r\n', language: "python" }]);
	});

	test("multiple headers and ordinary string-data heredoc", () => {
		const command = "python <<PY\nprint(1)\nPY\ncat <<PY\nnot Python code\nPY\nR <<RS\nprint(2)\nRS\necho done\n";
		expect(code(command)).toEqual([{ source: "print(1)\n", language: "python" }, { source: "print(2)\n", language: "r" }]);
	});

	test("multiple heredocs queued on one header keep command context", () => {
		const command = "python <<PY; ruby <<RB\nprint(1)\nPY\nputs 2\nRB\necho end\n";
		expect(code(command)).toEqual([{ source: "print(1)\n", language: "python" }, { source: "puts 2\n", language: "ruby" }]);
	});

	test("multiple stdin redirections on one command are ambiguous", () => {
		shell("python <<A <<B\nfirst data\nA\nsecond data\nB\necho end\n");
	});

	test("inline program's heredoc is input data, not program source", () => {
		const command = "python -c 'print(input())' <<EOF\narbitrary data\nEOF\necho done";
		expect(code(command)).toEqual([{ source: "print(input())", language: "python" }]);
		shell("python script.py <<EOF\narbitrary data\nEOF\n");
	});
});

describe("conservative shell fallback", () => {
	test.each([
		"", "echo hello", "constructor <<EOF\nplain data\nEOF\n", "sh -c 'print(1)'", "bash -c 'python -c echo'", "something -c 'print(1)'",
		"echo 'python -c \\\"print(1)\\\"'", "printf '%s' 'ruby -e puts'", "echo '<<PY'", "cat <<PY\nplain data\nPY\n",
		"python script.py -c 'string data'", "python -m app -c 'string data'", "python -- -c 'string data'",
		"python -W '-c' 'string data'", "node script.js -e 'string data'", "python -e 'print(1)'",
		"python -c 'print(1)", 'ruby -e "puts 1', "python -c 'first'\"second\"", "python -c unquoted",
		'python -c "print(\'$HOME\')"', "echo $(python -c 'print(1)')", "(python -c 'print(1)')",
		"python <<EOF\nprint(1)\n", "python <<EOF", "python <<\nprint(1)\n", "python >",
		"python <<EOF\nprint(1)\n EOF\n", "python <<-EOF\nprint(1)\n EOF\n",
		"cat >unknown.txt <<EOF\nplain data\nEOF\n", "cat >a.py >b.rb <<EOF\nambiguous\nEOF\n",
	])("does not misclassify %j", (command) => shell(command));

	test("malformed later input abandons earlier guesses", () => {
		shell("python -c 'print(1)'; ruby -e 'unterminated");
	});

	test("preservation across varied punctuation, Unicode and controls", () => {
		const pieces = ["a", " ", "\t", "\n", "\r\n", "'", '"', "\\", ";", "&&", "<<", "#", "$(", "🙂", "\0"];
		for (const left of pieces) for (const right of pieces) segments(left + "python -c 'hello'" + right);
	});
});
