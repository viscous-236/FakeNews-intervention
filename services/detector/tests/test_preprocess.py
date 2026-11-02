
from app.preprocess import preprocess_text


def test_preprocess_empty_and_whitespace():
    assert preprocess_text("") == ""
    assert preprocess_text("   ") == ""
    assert preprocess_text("\t\n\r  ") == ""


def test_preprocess_unicode_nfkc():
    # Fullwidth letters: Ｆｕｌｌ -> Full
    # Ligatures: ﬁ -> fi
    raw = "Ｔｈｉｓ is a ﬁne test statement."
    expected = "This is a fine test statement."
    assert preprocess_text(raw) == expected


def test_preprocess_url_replacement():
    raw = "Check this out https://example.com/breaking-news?id=42&ref=tw and http://foo.org/bar"
    expected = "Check this out <url> and <url>"
    assert preprocess_text(raw) == expected


def test_preprocess_user_replacement():
    raw = "Breaking report from @politifact and @user_123 on the vote"
    expected = "Breaking report from <user> and <user> on the vote"
    assert preprocess_text(raw) == expected


def test_preprocess_whitespace_collapsing_and_stripping():
    raw = "   Multiple   spaces   \n\n\tand \t tabs   should collapse.   "
    expected = "Multiple spaces and tabs should collapse."
    assert preprocess_text(raw) == expected


def test_preprocess_case_preserved():
    # Lowercasing must be left to vectorizer or tokenizer
    raw = "BREAKING: Donald Trump claims The White House did not respond."
    expected = "BREAKING: Donald Trump claims The White House did not respond."
    assert preprocess_text(raw) == expected


def test_preprocess_combined():
    raw = "  BREAKING: See @realDonaldTrump at https://t.co/xyz123   \n\tabout economy!  "
    expected = "BREAKING: See <user> at <url> about economy!"
    assert preprocess_text(raw) == expected
