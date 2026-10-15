static class SelfTests
{
    public static void Run()
    {
        var root = Path.Combine(Path.GetTempPath(), "sboxns-contract-tests-" + Guid.NewGuid().ToString("N"));
        try
        {
            void Check(string name, string before, string after, Action<Inspection> assert)
            {
                var a = Path.Combine(root, name, "base", "Code"); var b = Path.Combine(root, name, "head", "Code");
                Directory.CreateDirectory(a); Directory.CreateDirectory(b);
                File.WriteAllText(Path.Combine(a, "Client.cs"), before); File.WriteAllText(Path.Combine(b, "Client.cs"), after);
                var result = Inspector.Compare(Path.GetDirectoryName(a)!, Path.GetDirectoryName(b)!);
                if (result.Errors.Length != 0) throw new Exception(name + ": " + string.Join("; ", result.Errors));
                assert(result);
            }
            static void Require(bool condition, string message) { if (!condition) throw new Exception(message); }
            const string api = "namespace Sandbox; public static partial class Client { public static int Save(string key, int amount = 1) => amount; }";
            Check("removal", api, "namespace Sandbox; public static partial class Client { }", result => Require(result.Removed.Any(api => api.Symbol.EndsWith(".Save")), "Removing a public method was not blocked"));
            Check("optional-default", api, api.Replace("amount = 1", "amount = 2"), result => Require(result.Removed.Length == 1, "Optional default change lost compatibility impact"));
            Check("parameter-name", api, api.Replace("string key", "string player"), result => Require(result.Removed.Length == 1, "Named-argument rename was not detected"));
            Check("body-only", api, api.Replace("=> amount", "=> amount + 1"), result => Require(result.Removed.Length == 0 && result.NonTriviaChangedFiles.Length == 1, "Body change incorrectly classified safe or API removal"));
            Check("comments", api, "// comment\n" + api.Replace("=> amount", " /* other */ => amount"), result => Require(result.Removed.Length == 0 && result.NonTriviaChangedFiles.Length == 0, "Comments alone changed the contract"));
            Check("new-overload", api, api.Replace("=> amount;", "=> amount; public static int Save(int key) => key;"), result => Require(result.Removed.Length == 0 && result.Added.Length == 1, "New overload removed an existing contract"));
            Check("enum-values", "public enum Mode { Read = 1, Write = 2 }", "public enum Mode { Read = 2, Write = 1 }", result => Require(result.Removed.Length != 0, "Enum value changes went unnoticed"));
            Check("private-helper", "public class Client { private string Tag() => \"v3\"; }", "public class Client { private string Tag() => \"v4\"; }", result => Require(result.Removed.Length == 0 && result.NonTriviaChangedFiles.Length == 1, "Private helper semantic change was hidden"));
            Check("conditional-api", "#if FEATURE\npublic class Client { public void Save() {} }\n#endif", "#if FEATURE\npublic class Client { }\n#endif", result => Require(result.Removed.Any(api => api.Symbol.EndsWith(".Save")), "Inactive branch API was not inspected"));
            Check("directive-change", "#nullable enable\npublic class Client {}", "#nullable disable\npublic class Client {}", result => Require(result.NonTriviaChangedFiles.Length == 1, "Directive change incorrectly treated as whitespace"));
            Check("partial", "public partial class Client { public void Save() {} } public partial class Client { public void Load() {} }", "public partial class Client { public void Load() {} } public partial class Client { public void Save() {} }", result => Require(result.Removed.Length == 0 && result.Added.Length == 0, "Partial declaration ordering removed an API"));
            Console.WriteLine("Contract inspector: 11 behavioral regressions passed.");
        }
        finally { Directory.Delete(root, recursive: true); }
    }
}
