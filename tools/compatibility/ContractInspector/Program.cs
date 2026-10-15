using System.Text.Json;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

if (args.Contains("--self-test")) { SelfTests.Run(); return; }
string Option(string name) { var i = Array.IndexOf(args, name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : throw new ArgumentException($"Required {name}"); }
var result = Inspector.Compare(Option("--base"), Option("--head"));
File.WriteAllText(Option("--output"), JsonSerializer.Serialize(result, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true }));
Console.WriteLine($"Contract: {result.Removed.Length} removed/changed, {result.Added.Length} added; {result.NonTriviaChangedFiles.Length} meaningful files; {result.Errors.Length} parse errors.");
Environment.ExitCode = result.Errors.Length == 0 ? 0 : 2;

record Api(string Symbol, string Signature, string File, int Line);
record Change(string Symbol, string File, int Line);
record Inspection(Api[] Removed, Api[] Added, Change[] BodyChanged, string[] NonTriviaChangedFiles, string[] Errors);
sealed class Snapshot
{
    public Dictionary<string, Api> Api { get; } = new(StringComparer.Ordinal);
    public Dictionary<string, string> Files { get; } = new(StringComparer.Ordinal);
    public List<string> Errors { get; } = [];
}
static class Inspector
{
    static readonly string[] Roots = ["Code", "Editor"];
    public static Inspection Compare(string before, string after)
    {
        var old = Read(before); var next = Read(after);
        var removed = old.Api.Where(pair => !next.Api.ContainsKey(pair.Key)).Select(pair => pair.Value).OrderBy(api => api.Symbol, StringComparer.Ordinal).ToArray();
        var added = next.Api.Where(pair => !old.Api.ContainsKey(pair.Key)).Select(pair => pair.Value).OrderBy(api => api.Symbol, StringComparer.Ordinal).ToArray();
        var changed = old.Files.Keys.Union(next.Files.Keys, StringComparer.Ordinal).Where(file => !old.Files.TryGetValue(file, out var a) || !next.Files.TryGetValue(file, out var b) || a != b).Order(StringComparer.Ordinal).ToArray();
        return new(removed, added, changed.Select(file => new Change("file:" + file, file, 1)).ToArray(), changed, [.. old.Errors, .. next.Errors]);
    }
    public static string Tokens(SyntaxNode node) => string.Join(" ", node.DescendantTokens().Select(token => token.Text));
    static Snapshot Read(string root)
    {
        var snapshot = new Snapshot();
        foreach (var folder in Roots)
        {
            var directory = Path.Combine(root, folder);
            if (!Directory.Exists(directory)) continue;
            foreach (var file in Directory.EnumerateFiles(directory, "*.cs", SearchOption.AllDirectories).Order(StringComparer.Ordinal))
            {
                var relative = Path.GetRelativePath(root, file).Replace('\\', '/');
                if (relative.Split('/').Any(segment => segment is "obj" or "bin")) continue;
                var text = File.ReadAllText(file);
                var first = CSharpSyntaxTree.ParseText(text, new CSharpParseOptions(LanguageVersion.Preview));
                var symbols = first.GetRoot().DescendantTrivia(descendIntoTrivia: true).Select(trivia => trivia.GetStructure()).OfType<ConditionalDirectiveTriviaSyntax>()
                    .SelectMany(directive => directive.DescendantNodes().OfType<IdentifierNameSyntax>()).Select(identifier => identifier.Identifier.ValueText).Distinct(StringComparer.Ordinal).ToArray();
                if (symbols.Length > 6) { snapshot.Errors.Add($"{relative}: too many conditional configurations to inspect safely"); continue; }
                // Inspect every conditional configuration, not just the engine's current #defines.
                for (var mask = 0; mask < (1 << symbols.Length); mask++)
                {
                    var enabled = symbols.Where((_, index) => (mask & (1 << index)) != 0);
                    var tree = CSharpSyntaxTree.ParseText(text, new CSharpParseOptions(LanguageVersion.Preview, preprocessorSymbols: enabled));
                    var unit = tree.GetCompilationUnitRoot();
                    foreach (var diagnostic in tree.GetDiagnostics().Where(diagnostic => diagnostic.Severity == DiagnosticSeverity.Error)) snapshot.Errors.Add($"{relative}: {diagnostic}");
                    foreach (var declaration in unit.Members) Visit(declaration, "", "", false, relative, snapshot);
                }
                var directives = first.GetRoot().DescendantTrivia(descendIntoTrivia: true).Where(trivia => trivia.HasStructure && trivia.GetStructure() is DirectiveTriviaSyntax).Select(trivia => Tokens(trivia.GetStructure()!));
                var disabled = first.GetRoot().DescendantTrivia(descendIntoTrivia: true).Where(trivia => trivia.IsKind(SyntaxKind.DisabledTextTrivia)).Select(trivia => trivia.ToFullString());
                snapshot.Files[relative] = Tokens(first.GetRoot()) + "|directives:" + string.Join("|", directives) + "|disabled:" + string.Join("|", disabled);
            }
        }
        return snapshot;
    }
    static bool Visible(SyntaxTokenList modifiers, bool implicitPublic) => !modifiers.Any(SyntaxKind.PrivateKeyword) && (implicitPublic || modifiers.Any(SyntaxKind.PublicKeyword) || modifiers.Any(SyntaxKind.ProtectedKeyword));
    static void Add(MemberDeclarationSyntax original, SyntaxNode header, string owner, string name, string file, Snapshot snapshot)
    {
        var api = new Api(owner.Length == 0 ? name : owner + "." + name, Tokens(header), file, original.GetLocation().GetLineSpan().StartLinePosition.Line + 1);
        snapshot.Api.TryAdd(api.Symbol + "|" + api.Signature, api); // Partial declarations share the same externally visible shape.
    }
    static PropertyDeclarationSyntax PropertyHeader(PropertyDeclarationSyntax property)
    {
        var accessors = property.AccessorList ?? SyntaxFactory.AccessorList(SyntaxFactory.SingletonList(SyntaxFactory.AccessorDeclaration(SyntaxKind.GetAccessorDeclaration)));
        return property.WithExpressionBody(null).WithSemicolonToken(default).WithAccessorList(Accessors(accessors));
    }
    static AccessorListSyntax Accessors(AccessorListSyntax accessors) => accessors.WithAccessors(SyntaxFactory.List(accessors.Accessors.Select(accessor => accessor.WithBody(null).WithExpressionBody(null).WithSemicolonToken(SyntaxFactory.Token(SyntaxKind.SemicolonToken)))));
    static void Visit(MemberDeclarationSyntax member, string ns, string parent, bool interfaceMember, string file, Snapshot snapshot)
    {
        if (member is BaseNamespaceDeclarationSyntax space)
        {
            var name = ns.Length == 0 ? space.Name.ToString() : ns + "." + space.Name;
            foreach (var child in space.Members) Visit(child, name, parent, false, file, snapshot);
            return;
        }
        var owner = parent.Length == 0 ? ns : parent;
        if (member is BaseTypeDeclarationSyntax baseType)
        {
            if (!Visible(baseType.Modifiers, interfaceMember)) return;
            var typeName = baseType.Identifier.ValueText + (baseType is TypeDeclarationSyntax generic && generic.TypeParameterList is { Parameters.Count: > 0 } parameters ? "`" + parameters.Parameters.Count : "");
            var qualified = owner.Length == 0 ? typeName : owner + "." + typeName;
            if (baseType is EnumDeclarationSyntax enumeration)
            {
                // Ordinal values and order are part of an enum contract; fail conservatively on changes.
                Add(member, enumeration, owner, enumeration.Identifier.ValueText, file, snapshot);
            }
            else if (baseType is TypeDeclarationSyntax type)
            {
                Add(member, type.WithMembers(default), owner, typeName, file, snapshot);
                foreach (var child in type.Members) Visit(child, ns, qualified, type is InterfaceDeclarationSyntax, file, snapshot);
            }
            return;
        }
        switch (member)
        {
            case DelegateDeclarationSyntax declaration when Visible(declaration.Modifiers, interfaceMember):
                Add(member, declaration, owner, declaration.Identifier.ValueText, file, snapshot); break;
            case MethodDeclarationSyntax declaration when Visible(declaration.Modifiers, interfaceMember):
                Add(member, declaration.WithBody(null).WithExpressionBody(null).WithSemicolonToken(default), owner, declaration.Identifier.ValueText, file, snapshot); break;
            case ConstructorDeclarationSyntax declaration when Visible(declaration.Modifiers, interfaceMember):
                Add(member, declaration.WithBody(null).WithExpressionBody(null), owner, ".ctor", file, snapshot); break;
            case PropertyDeclarationSyntax declaration when Visible(declaration.Modifiers, interfaceMember):
                Add(member, PropertyHeader(declaration), owner, declaration.Identifier.ValueText, file, snapshot); break;
            case IndexerDeclarationSyntax declaration when Visible(declaration.Modifiers, interfaceMember):
                Add(member, declaration.WithExpressionBody(null).WithAccessorList(declaration.AccessorList is null ? null : Accessors(declaration.AccessorList)), owner, "this", file, snapshot); break;
            case FieldDeclarationSyntax declaration when Visible(declaration.Modifiers, interfaceMember):
                foreach (var variable in declaration.Declaration.Variables) Add(member, declaration.WithDeclaration(declaration.Declaration.WithVariables(SyntaxFactory.SingletonSeparatedList(variable))), owner, variable.Identifier.ValueText, file, snapshot);
                break;
            case EventFieldDeclarationSyntax declaration when Visible(declaration.Modifiers, interfaceMember):
                foreach (var variable in declaration.Declaration.Variables) Add(member, declaration.WithDeclaration(declaration.Declaration.WithVariables(SyntaxFactory.SingletonSeparatedList(variable))), owner, variable.Identifier.ValueText, file, snapshot);
                break;
            case EventDeclarationSyntax declaration when Visible(declaration.Modifiers, interfaceMember):
                Add(member, declaration.WithAccessorList(declaration.AccessorList is null ? null : Accessors(declaration.AccessorList)), owner, declaration.Identifier.ValueText, file, snapshot); break;
            case OperatorDeclarationSyntax declaration when Visible(declaration.Modifiers, interfaceMember):
                Add(member, declaration.WithBody(null).WithExpressionBody(null), owner, "operator " + declaration.OperatorToken.Text, file, snapshot); break;
            case ConversionOperatorDeclarationSyntax declaration when Visible(declaration.Modifiers, interfaceMember):
                Add(member, declaration.WithBody(null).WithExpressionBody(null), owner, "operator " + declaration.Type, file, snapshot); break;
        }
    }
}
