import importlib.util
import os


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location(
    "build_legal_entity_applicability",
    os.path.join(ROOT, "tools", "build_legal_entity_applicability.py"),
)
applicability_builder = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(applicability_builder)


def test_build_mapping_accepts_both_eu_citation_orders():
    rows = [
        {"Legal Entity": "Deutsche Boerse AG", "Regulation Short Name": "(EU) 648/2012 (EMIR)"},
        {"Legal Entity": "Eurex Repo GmbH", "Regulation Short Name": "2014/65/EU (MiFID II)"},
    ]
    registry = {
        "acts": [
            {"id": "emir", "authId": "celex:32012R0648"},
            {"id": "mifid", "authId": "celex:32014L0065"},
            {"id": "unmatched", "authId": "celex:32024R1689"},
        ]
    }

    mapping = applicability_builder.build_mapping(rows, registry)

    assert mapping["emir"] == [{"shortName": "DBAG", "name": "Deutsche Boerse AG"}]
    assert mapping["mifid"] == [{"shortName": "ERG", "name": "Eurex Repo GmbH"}]
    assert "unmatched" not in mapping


def test_build_bundle_mapping_aggregates_nested_descendant_acts():
    act_mapping = {
        "core": [{"shortName": "CHAG", "name": "Clearstream Holding AG"}],
        "rts-1": [{"shortName": "CEAG", "name": "Clearstream Europe AG"}],
    }
    bundles = [{
        "id": "dora",
        "members": [
            {"ref": "core"},
            {"type": "bundle", "id": "rts", "members": [{"ref": "rts-1"}]},
        ],
    }]

    mapping = applicability_builder.build_bundle_mapping(bundles, act_mapping)

    assert mapping["rts"] == [{"shortName": "CEAG", "name": "Clearstream Europe AG"}]
    assert mapping["dora"] == [
        {"shortName": "CEAG", "name": "Clearstream Europe AG"},
        {"shortName": "CHAG", "name": "Clearstream Holding AG"},
    ]


def test_build_family_mapping_propagates_root_scope_to_all_descendants():
    bundles = [{
        "id": "dora",
        "members": [
            {"ref": "directive"},
            {"type": "bundle", "id": "rts", "members": [{"ref": "rts-1"}]},
        ],
    }]
    entities = [
        {"shortName": "CEAG", "name": "Clearstream Europe AG"},
        {"shortName": "CHAG", "name": "Clearstream Holding AG"},
    ]

    mapping = applicability_builder.build_family_mapping(bundles, {"dora": entities})

    assert mapping == {
        "dora": entities,
        "directive": entities,
        "rts": entities,
        "rts-1": entities,
    }