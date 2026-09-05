// A ste-lint fixture opens with the counts it must produce, and it breaks a
// rule on purpose to produce them. This checker does not lint its own fixtures:
// the file is test data, and src/fixtures.test.ts asserts every count in that
// header by name. The skip is announced, so a file that lands here by accident
// is visible rather than quietly unchecked.
const EXPECT_HEADER = /^<!--\s*expect:\s*\S.*?-->\s*$/;

export function isFixture(text: string): boolean {
	return EXPECT_HEADER.test((text.split('\n')[0] ?? '').trim());
}
