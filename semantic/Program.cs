using System.CommandLine;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using VDS.RDF;
using VDS.RDF.Parsing;
using VDS.RDF.Query;
using VDS.RDF.Shacl;
using VDS.RDF.Writing;

var root = new RootCommand("MusicAtlas read-only semantic tools");
var data = new Argument<FileInfo>("data");
var queryFile = new Argument<FileInfo>("query");
var query = new Command("query", "Execute a local SPARQL query (SELECT, ASK, CONSTRUCT, DESCRIBE)");
query.Arguments.Add(data);
query.Arguments.Add(queryFile);
query.SetAction(p => {
    var graph = Load(p.GetValue(data)!);
    using var store = new TripleStore();
    store.Add(graph);
    var parsed = new SparqlQueryParser().ParseFromFile(p.GetValue(queryFile)!.FullName);
    var result = new LeviathanQueryProcessor(store).ProcessQuery(parsed);
    if (result is SparqlResultSet results)
        new SparqlJsonWriter().Save(results, Console.Out);
    else if (result is IGraph triples)
        new CompressingTurtleWriter().Save(triples, Console.Out);
    return 0;
});
root.Subcommands.Add(query);

var shapesFile = new Argument<FileInfo>("shapes");
var validateData = new Argument<FileInfo>("data");
var validate = new Command("validate", "Check RDF against generated SHACL shapes");
validate.Arguments.Add(validateData);
validate.Arguments.Add(shapesFile);
validate.SetAction(p => {
    var conforms = new ShapesGraph(Load(p.GetValue(shapesFile)!)).Conforms(Load(p.GetValue(validateData)!));
    Console.WriteLine(JsonSerializer.Serialize(new { conforms }));
    return conforms ? 0 : 1;
});
root.Subcommands.Add(validate);

var database = new Argument<FileInfo>("database");
var stats = new Command("stats", "Read corpus counts directly from the SQLite projection");
stats.Arguments.Add(database);
stats.SetAction(p => {
    using var connection = new SqliteConnection(new SqliteConnectionStringBuilder {
        DataSource = p.GetValue(database)!.FullName, Mode = SqliteOpenMode.ReadOnly
    }.ToString());
    connection.Open();
    var counts = new Dictionary<string,long>();
    foreach (var table in new[] { "artist", "fact", "participant" }) {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"SELECT count(*) FROM {table}";
        counts[table] = Convert.ToInt64(cmd.ExecuteScalar());
    }
    Console.WriteLine(JsonSerializer.Serialize(counts));
    return 0;
});
root.Subcommands.Add(stats);
return root.Parse(args).Invoke();

static Graph Load(FileInfo file) {
    var graph = new Graph();
    FileLoader.Load(graph, file.FullName);
    return graph;
}
